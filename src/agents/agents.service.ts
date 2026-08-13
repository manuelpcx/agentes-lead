import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Agent, AgentType, Channel, Direction, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { PromptService } from '../prompts/prompt.service';
import { AgentRouterService, RouteInput } from './agent-router.service';
import {
  DEFAULT_ENABLED_TOOLS,
  TOOL_DERIVAR_A_AGENTE,
  TOOL_ESCALAR_A_HUMANO,
} from '../agent/tools/tool-names';

/** Métricas comparadas de un agente (Fase 8, calculadas on-the-fly). */
export interface AgentMetricsRow {
  agentId: string;
  name: string;
  type: AgentType;
  isActive: boolean;
  isDefault: boolean;
  leadsACargo: number;
  citasAgendadas: number;
  escalamientos: number;
  mensajesSalientes: number;
  derivacionesEnviadas: number;
}

/** Un traspaso reciente entre agentes (para la vista de handoffs). */
export interface HandoffRow {
  leadId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  toAgentName: string | null;
  motivo: string | null;
  resumen: string | null;
  occurredAt: Date;
}

/** Canales de conversación real (no `system`), para contar mensajes. */
const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

/**
 * Cliente Prisma aceptado por los métodos que participan en una transacción.
 * Permite reusar la lógica dentro o fuera de un `$transaction`.
 */
type PrismaLike = Pick<PrismaService['db'], 'agent' | 'promptVersion'>;

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prompts: PromptService,
    private readonly router: AgentRouterService,
  ) {}

  /**
   * Crea el agente por defecto (tipo VENTAS) de una empresa recién creada, con
   * las 5 herramientas iniciales y el canal WhatsApp habilitados, y siembra su
   * system prompt activo. Acepta un cliente transaccional para atomicidad.
   */
  async createDefaultAgent(
    companyId: string,
    client: PrismaLike = this.prisma.db,
  ) {
    const agent = await client.agent.create({
      data: {
        companyId,
        name: 'Agente de Ventas',
        type: AgentType.VENTAS,
        description: 'Agente por defecto creado al registrar la empresa.',
        channels: ['whatsapp'],
        enabledTools: DEFAULT_ENABLED_TOOLS,
        knowledgeScope: {},
      },
    });

    await this.prompts.seedDefaultPrompt(
      companyId,
      agent.id,
      AgentType.VENTAS,
      client,
    );

    return agent;
  }

  /**
   * Resuelve el agente a cargo de un lead delegando en el router (Fase 8):
   * enruta por canal → estado → clasificador. Sin criterios cae al desempate
   * determinista. Se filtra por tenant automáticamente.
   */
  async resolveDefaultAgentId(
    client: PrismaLike = this.prisma.db,
    criteria: RouteInput = {},
  ): Promise<string> {
    return this.router.route(criteria, client);
  }

  /** Lista los agentes de la empresa activa (aislado por tenant). */
  async list(): Promise<Agent[]> {
    return this.prisma.db.agent.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─────────────────────── gestión desde el panel (Fase 8) ───────────────────────

  /** Crea un agente y siembra su prompt activo. Aplica default único. */
  async create(input: {
    name: string;
    type?: AgentType;
    description?: string;
    channels?: string[];
    leadStates?: string[];
    enabledTools?: string[];
    priority?: number;
    isDefault?: boolean;
  }): Promise<Agent> {
    const companyId = TenantContext.requireCompanyId();
    const type = input.type ?? AgentType.CUSTOM;
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.agent.updateMany({ data: { isDefault: false } });
      }
      const agent = await tx.agent.create({
        data: {
          companyId,
          name: input.name,
          type,
          description: input.description,
          channels: input.channels ?? [],
          leadStates: input.leadStates ?? [],
          enabledTools: input.enabledTools ?? DEFAULT_ENABLED_TOOLS,
          priority: input.priority ?? 0,
          isDefault: input.isDefault ?? false,
          knowledgeScope: {},
        },
      });
      await this.prompts.seedDefaultPrompt(companyId, agent.id, type, tx);
      return agent;
    });
  }

  /** Actualiza la configuración de un agente. Mantiene un único default. */
  async update(
    id: string,
    data: Prisma.AgentUpdateInput & { isDefault?: boolean },
  ): Promise<Agent> {
    await this.getByIdOrThrow(id);
    return this.prisma.db.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.agent.updateMany({
          where: { id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.agent.update({ where: { id }, data });
    });
  }

  /**
   * Desactiva un agente y reasigna sus leads a un fallback. No permite dejar la
   * empresa sin agentes activos.
   */
  async deactivate(id: string): Promise<Agent> {
    await this.getByIdOrThrow(id);
    const activos = await this.prisma.db.agent.count({
      where: { isActive: true },
    });
    if (activos <= 1) {
      throw new BadRequestException(
        'No puedes desactivar el único agente activo de la empresa',
      );
    }
    // Fallback para los leads que estaban a su cargo (excluye al desactivado).
    const fallbackId = await this.router.route({ excludeAgentId: id });
    return this.prisma.db.$transaction(async (tx) => {
      await tx.lead.updateMany({
        where: { agentId: id },
        data: { agentId: fallbackId },
      });
      return tx.agent.update({
        where: { id },
        data: { isActive: false, isDefault: false },
      });
    });
  }

  /** Métricas comparadas por agente (leads, citas, escalamientos, mensajes). */
  async metrics(): Promise<AgentMetricsRow[]> {
    const agents = await this.prisma.db.agent.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      agents.map(async (a) => {
        const [
          leadsACargo,
          citasAgendadas,
          escalamientos,
          mensajesSalientes,
          derivacionesEnviadas,
        ] = await Promise.all([
          this.prisma.db.lead.count({ where: { agentId: a.id } }),
          this.prisma.db.appointment.count({ where: { agentId: a.id } }),
          this.prisma.db.agentAction.count({
            where: { agentId: a.id, tool: TOOL_ESCALAR_A_HUMANO },
          }),
          this.prisma.db.interaction.count({
            where: {
              agentId: a.id,
              direction: Direction.outbound,
              channel: { in: CONVERSATION_CHANNELS },
            },
          }),
          this.prisma.db.agentAction.count({
            where: { agentId: a.id, tool: TOOL_DERIVAR_A_AGENTE },
          }),
        ]);
        return {
          agentId: a.id,
          name: a.name,
          type: a.type,
          isActive: a.isActive,
          isDefault: a.isDefault,
          leadsACargo,
          citasAgendadas,
          escalamientos,
          mensajesSalientes,
          derivacionesEnviadas,
        };
      }),
    );
  }

  /** Traspasos recientes entre agentes (interacciones `system` de derivación). */
  async handoffs(limit = 20): Promise<HandoffRow[]> {
    const rows = await this.prisma.db.interaction.findMany({
      where: {
        channel: Channel.system,
        metadata: { path: ['kind'], equals: 'derivacion' },
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: { leadId: true, metadata: true, occurredAt: true },
    });
    return rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        leadId: r.leadId,
        fromAgentId: (m.fromAgentId as string) ?? null,
        toAgentId: (m.toAgentId as string) ?? null,
        toAgentName: (m.toAgentName as string) ?? null,
        motivo: (m.motivo as string) ?? null,
        resumen: (m.resumen as string) ?? null,
        occurredAt: r.occurredAt,
      };
    });
  }

  private async getByIdOrThrow(id: string): Promise<Agent> {
    const agent = await this.prisma.db.agent.findFirst({ where: { id } });
    if (!agent) {
      throw new NotFoundException('Agente no encontrado');
    }
    return agent;
  }
}
