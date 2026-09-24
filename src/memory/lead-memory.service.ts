import { Injectable, Logger } from '@nestjs/common';
import { Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AnthropicService } from '../llm/anthropic.service';
import { CONVERSATION_CHANNELS } from '../agent/agent.constants';
import {
  MAX_SUMMARY_CHARS,
  MemoryFact,
  parseFacts,
  removeFact,
  upsertFact,
} from './lead-memory';

/** Memoria de un lead tal como la consume el resto de la app. */
export interface LeadMemoryView {
  summary: string | null;
  facts: MemoryFact[];
  updatedAt: Date | null;
}

/**
 * Cada cuántas interacciones nuevas se rehace el resumen. Con la ventana de
 * historial en 30 mensajes, refrescar cada 10 significa que nada sale de la
 * ventana sin haber pasado por el resumen al menos una vez.
 */
export const REFRESH_EVERY_INTERACTIONS = 10;

/** Cuántas interacciones recientes se le pasan al modelo para resumir. */
const SUMMARY_WINDOW = 40;

const SUMMARY_SYSTEM = `Eres el archivista de un equipo comercial. Recibes lo que ya se sabía de una persona y la parte más reciente de su conversación, y devuelves un resumen ACTUALIZADO de quién es y en qué quedó la relación.

REGLAS:
- Escribe en español, en prosa, máximo 6 líneas. Sin encabezados ni viñetas.
- Solo lo que sirva para retomar la conversación: qué busca, qué le preocupa, qué se acordó, cómo prefiere que lo contacten, y el estado de la relación.
- NO incluyas cifras exactas, montos, precios ni fechas concretas. Di "mencionó un presupuesto acotado" o "pidió una fecha para la próxima semana", nunca el número ni el día.
- No inventes nada que no esté en el material. Si no hay nada relevante, devuelve una sola línea diciendo que aún no hay información útil.
- Devuelve SOLO el resumen, sin comillas ni texto adicional.`;

/**
 * Memoria viva del lead: el perfil que sobrevive más allá de la ventana de
 * mensajes. Se llena por dos vías: la herramienta `guardarEnMemoria`, con la
 * que el agente anota un hecho concreto, y un resumen en prosa que se rehace
 * en segundo plano cada `REFRESH_EVERY_INTERACTIONS` interacciones.
 */
@Injectable()
export class LeadMemoryService {
  private readonly logger = new Logger(LeadMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
  ) {}

  /** Memoria del lead; vacía si nunca se guardó nada. */
  async get(leadId: string): Promise<LeadMemoryView> {
    const row = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { summary: true, facts: true, updatedAt: true },
    });
    return {
      summary: row?.summary ?? null,
      facts: parseFacts(row?.facts),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Guarda (o reemplaza) un hecho. Devuelve la lista resultante. */
  async rememberFact(
    leadId: string,
    clave: string,
    valor: string,
  ): Promise<MemoryFact[]> {
    const actuales = parseFacts(await this.rawFacts(leadId));
    const facts = upsertFact(actuales, clave, valor);
    await this.save(leadId, { facts });
    return facts;
  }

  /** Olvida un hecho por su clave. */
  async forgetFact(leadId: string, clave: string): Promise<MemoryFact[]> {
    const facts = removeFact(parseFacts(await this.rawFacts(leadId)), clave);
    await this.save(leadId, { facts });
    return facts;
  }

  /** Reemplaza el resumen a mano (edición desde el panel). */
  async setSummary(leadId: string, summary: string | null): Promise<void> {
    await this.save(leadId, {
      summary: summary?.trim()
        ? summary.trim().slice(0, MAX_SUMMARY_CHARS)
        : null,
    });
  }

  /**
   * ¿Conviene rehacer el resumen? True cuando se acumularon suficientes
   * interacciones nuevas desde la última vez. Es una sola consulta de conteo:
   * se llama al final de cada turno, así que tiene que ser barata.
   */
  async needsRefresh(leadId: string): Promise<boolean> {
    if (!this.anthropic.isConfigured()) {
      return false;
    }
    const row = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { summarizedUpto: true },
    });
    const nuevas = await this.prisma.db.interaction.count({
      where: {
        leadId,
        channel: { in: CONVERSATION_CHANNELS },
        ...(row?.summarizedUpto
          ? { occurredAt: { gt: row.summarizedUpto } }
          : {}),
      },
    });
    return nuevas >= REFRESH_EVERY_INTERACTIONS;
  }

  /**
   * Rehace el resumen con una llamada barata al modelo. Corre fuera del turno
   * (cola `lead-memory`), así que su latencia no la paga el cliente. Si no hay
   * LLM o no hay conversación, no hace nada.
   */
  async refreshSummary(leadId: string): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const recientes = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      take: SUMMARY_WINDOW,
      select: { direction: true, content: true, occurredAt: true },
    });
    if (recientes.length === 0) {
      return;
    }
    const cronologicas = recientes.reverse();
    const transcripcion = cronologicas
      .map(
        (i) =>
          `${i.direction === Direction.inbound ? 'Cliente' : 'Equipo'}: ` +
          i.content.slice(0, 500),
      )
      .join('\n');

    const actual = await this.get(leadId);
    const previo = actual.summary ?? '(todavía no hay resumen)';
    const hechos =
      actual.facts.length > 0
        ? actual.facts.map((f) => `- ${f.clave}: ${f.valor}`).join('\n')
        : '(sin hechos registrados)';

    try {
      const resumen = await this.anthropic.complete(
        SUMMARY_SYSTEM,
        `LO QUE YA SE SABÍA:\n${previo}\n\nHECHOS REGISTRADOS:\n${hechos}\n\n` +
          `CONVERSACIÓN RECIENTE:\n${transcripcion}`,
      );
      if (!resumen.trim()) {
        return;
      }
      await this.save(leadId, {
        summary: resumen.trim().slice(0, MAX_SUMMARY_CHARS),
        // Marca hasta dónde llegó este resumen: lo que venga después es lo que
        // cuenta para decidir el próximo refresco.
        summarizedUpto: cronologicas[cronologicas.length - 1].occurredAt,
      });
      this.logger.log(`Memoria actualizada (leadId=${leadId})`);
    } catch (error) {
      // Un resumen es una mejora, no un requisito: si falla, el turno siguiente
      // sigue funcionando con el historial y los hechos.
      this.logger.warn(
        `No se pudo actualizar la memoria (leadId=${leadId}): ${(error as Error).message}`,
      );
    }
  }

  // ─────────────────────── privados ───────────────────────

  private async rawFacts(leadId: string): Promise<unknown> {
    const row = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { facts: true },
    });
    return row?.facts;
  }

  /** Inserta o actualiza la fila de memoria del lead. */
  private async save(
    leadId: string,
    data: {
      summary?: string | null;
      facts?: MemoryFact[];
      summarizedUpto?: Date;
    },
  ): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const existente = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { id: true },
    });
    if (existente) {
      await this.prisma.db.leadMemory.update({
        where: { id: existente.id },
        data,
      });
      return;
    }
    await this.prisma.db.leadMemory.create({
      data: {
        companyId,
        leadId,
        summary: data.summary ?? null,
        facts: data.facts ?? [],
        summarizedUpto: data.summarizedUpto ?? null,
      },
    });
  }
}
