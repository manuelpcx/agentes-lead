import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';

/**
 * Cliente Prisma aceptado por el router. Permite reusarlo dentro o fuera de una
 * transacción (p. ej. durante la creación de un lead).
 */
type PrismaLike = Pick<PrismaService['db'], 'agent'>;

/** Criterios para enrutar un lead a un agente. */
export interface RouteInput {
  /** Canal del mensaje (whatsapp, email, call...). */
  channel?: string | null;
  /** Estado actual del lead (nombre del enum LeadStatus como texto). */
  status?: string | null;
  /**
   * Tipo de agente deseado (valor de AgentType como texto, p. ej. 'COBRANZA').
   * Señal fuerte para enrutar por especialidad desde la creación; si ningún
   * agente activo es de ese tipo, se ignora (no bloquea).
   */
  agentType?: string | null;
  /**
   * Último mensaje del cliente. Solo se usa para el clasificador LLM cuando,
   * tras filtrar por canal y estado, siguen quedando varios candidatos.
   */
  message?: string | null;
  /** Agente a excluir (p. ej. el que deriva, en un traspaso). */
  excludeAgentId?: string;
}

/**
 * Decide qué agente queda a cargo de un lead. Enruta en el orden de simplicidad
 * del plan (Fase 8): **por canal → por estado → clasificador LLM**. Si tras los
 * filtros deterministas queda un único candidato, se usa sin llamar al modelo.
 * Sin LLM (o sin mensaje) degrada a un desempate determinista por
 * `isDefault` → `priority` → orden de creación. La regla de conflicto ("un solo
 * agente a cargo") se resuelve aguas arriba: `Lead.agentId` es la única fuente
 * de verdad, así que el enrutamiento solo elige a quién asignar/derivar.
 */
@Injectable()
export class AgentRouterService {
  private readonly logger = new Logger(AgentRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
  ) {}

  /** Resuelve el `agentId` a cargo según los criterios. Lanza si no hay agentes. */
  async route(
    input: RouteInput = {},
    client: PrismaLike = this.prisma.db,
  ): Promise<string> {
    const activos = await client.agent.findMany({ where: { isActive: true } });
    const candidatos = input.excludeAgentId
      ? activos.filter((a) => a.id !== input.excludeAgentId)
      : activos;

    // Si excluir al que deriva deja la lista vacía, se permite auto-asignación.
    const base = candidatos.length > 0 ? candidatos : activos;
    if (base.length === 0) {
      throw new NotFoundException(
        'La empresa no tiene un agente activo asignable',
      );
    }

    // 0) Por tipo de agente (especialidad): señal más fuerte. Si el lead pide
    //    COBRANZA y existe un agente de ese tipo, se queda con esos.
    const porTipo = this.filtrarPorTipo(base, input.agentType);
    // 1) Por canal.
    const porCanal = this.filtrarPorCanal(porTipo, input.channel);
    // 2) Por estado del lead.
    const porEstado = this.filtrarPorEstado(porCanal, input.status);

    if (porEstado.length === 1) {
      return porEstado[0].id;
    }

    // 3) Clasificador LLM (solo si hay ambigüedad, mensaje y credenciales).
    if (input.message && this.anthropic.isConfigured()) {
      const elegido = await this.clasificar(porEstado, input.message);
      if (elegido) {
        return elegido.id;
      }
    }

    return this.desempatar(porEstado).id;
  }

  // ─────────────────────── filtros deterministas ───────────────────────

  /**
   * Conserva agentes del tipo pedido (`AgentType` como texto). Si ninguno es de
   * ese tipo, devuelve la entrada intacta (no bloquea el enrutamiento).
   */
  private filtrarPorTipo(agents: Agent[], agentType?: string | null): Agent[] {
    if (!agentType) {
      return agents;
    }
    const match = agents.filter((a) => a.type === agentType);
    return match.length > 0 ? match : agents;
  }

  /**
   * Conserva agentes cuyos `channels` incluyan el canal (o lo tengan vacío =
   * cualquiera). Si el filtro deja la lista vacía, devuelve la entrada intacta
   * (mejor un agente que ninguno).
   */
  private filtrarPorCanal(agents: Agent[], channel?: string | null): Agent[] {
    if (!channel) {
      return agents;
    }
    const match = agents.filter(
      (a) => a.channels.length === 0 || a.channels.includes(channel),
    );
    return match.length > 0 ? match : agents;
  }

  /** Igual que el filtro por canal pero sobre `leadStates`. */
  private filtrarPorEstado(agents: Agent[], status?: string | null): Agent[] {
    if (!status) {
      return agents;
    }
    const match = agents.filter(
      (a) => a.leadStates.length === 0 || a.leadStates.includes(status),
    );
    return match.length > 0 ? match : agents;
  }

  /** Desempate determinista: isDefault → mayor priority → más antiguo. */
  private desempatar(agents: Agent[]): Agent {
    return [...agents].sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
  }

  // ─────────────────────── clasificador LLM ───────────────────────

  /**
   * Pide al modelo elegir el agente más adecuado para el mensaje entre los
   * candidatos, devolviendo su índice. Ante cualquier ambigüedad o error,
   * devuelve null y el llamador cae al desempate determinista.
   */
  private async clasificar(
    agents: Agent[],
    message: string,
  ): Promise<Agent | null> {
    const catalogo = agents
      .map(
        (a, i) =>
          `${i}. ${a.name} (tipo ${a.type})` +
          (a.description ? ` — ${a.description}` : ''),
      )
      .join('\n');

    const system =
      'Eres un enrutador de conversaciones. Dado un mensaje de un cliente y una ' +
      'lista de agentes especializados, elige el más adecuado. Responde SOLO con ' +
      'el número de índice del agente elegido, sin texto adicional.';

    try {
      const raw = await this.anthropic.complete(
        system,
        `Agentes disponibles:\n${catalogo}\n\nMensaje del cliente:\n"""${message}"""\n\nÍndice del agente:`,
        { background: true },
      );
      const idx = Number.parseInt(raw.match(/\d+/)?.[0] ?? '', 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < agents.length) {
        return agents[idx];
      }
      this.logger.warn(`Clasificador devolvió índice inválido: "${raw}"`);
      return null;
    } catch (error) {
      this.logger.warn(
        `Clasificador falló, se usa desempate determinista: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
