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
import { Insight, parseInsights, parseInsightsResponse } from './insights';
import { ConversationRecallService } from './conversation-recall.service';

/** Memoria de un lead tal como la consume el resto de la app. */
export interface LeadMemoryView {
  summary: string | null;
  facts: MemoryFact[];
  insights: Insight[];
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

/** Cuántas interacciones recientes ve el modelo para sacar conclusiones. */
const INSIGHTS_WINDOW = 40;

const INSIGHTS_SYSTEM = `Eres un analista de un equipo comercial y de cobranza. Recibes lo que se sabe de una persona y su conversación reciente, con cada mensaje numerado (#1, #2…). Deduces CONCLUSIONES sobre ella: cosas que no están dichas literalmente en ningún mensaje y que cambian cómo conviene tratarla.

REGLAS:
- Hasta 3 conclusiones, en español, de una frase cada una: su motivación real, su objeción de fondo, su situación, o un patrón de comportamiento (cuándo responde, qué la hace avanzar o frenarse).
- Cada conclusión DEBE citar los mensajes que la respaldan por su referencia (#n). Si no puedes citar evidencia, no la incluyas.
- No repitas hechos que ya están en HECHOS REGISTRADOS: infiere algo nuevo a partir de ellos.
- No incluyas cifras exactas, montos ni fechas.
- No infieras datos sensibles: salud, religión, política, orientación sexual ni origen étnico.
- Si no hay base suficiente, devuelve una lista vacía.

Responde SOLO con JSON válido, sin markdown:
{"conclusiones": [{"texto": "...", "evidencia": ["#3", "#7"]}]}`;

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
    private readonly recall: ConversationRecallService,
  ) {}

  /** Memoria del lead; vacía si nunca se guardó nada. */
  async get(leadId: string): Promise<LeadMemoryView> {
    const row = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { summary: true, facts: true, insights: true, updatedAt: true },
    });
    return {
      summary: row?.summary ?? null,
      facts: parseFacts(row?.facts),
      insights: parseInsights(row?.insights),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * Guarda (o reemplaza) un hecho. Devuelve la lista resultante, que puede no
   * incluirlo si la memoria estaba llena de hechos más importantes.
   */
  async rememberFact(
    leadId: string,
    clave: string,
    valor: string,
    importancia?: number,
  ): Promise<MemoryFact[]> {
    const actuales = parseFacts(await this.rawFacts(leadId));
    const facts = upsertFact(actuales, clave, valor, importancia);
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
    // También cuando hay mensajes viejos sin indexar para la recuperación: si
    // no, un lead de antes de esa función esperaría 10 mensajes nuevos.
    return (
      (await this.needsSummary(leadId)) ||
      (await this.recall.needsIndexing(leadId))
    );
  }

  /** ¿Se juntaron suficientes interacciones nuevas para rehacer el resumen? */
  private async needsSummary(leadId: string): Promise<boolean> {
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
        { background: true },
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

  /**
   * Rehace las conclusiones del lead (reflexiones, como en *Generative
   * Agents*): hasta tres inferencias sobre la persona, cada una citando los
   * mensajes que la respaldan. Los mensajes van numerados (#1, #2…) y el
   * modelo cita esos números; `parseInsightsResponse` los traduce a ids y
   * descarta lo que no tenga respaldo. Si la respuesta no se puede leer, se
   * conservan las conclusiones anteriores.
   */
  async refreshInsights(leadId: string): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const recientes = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      take: INSIGHTS_WINDOW,
      select: { id: true, direction: true, content: true, occurredAt: true },
    });
    if (recientes.length === 0) {
      return;
    }
    const cronologicas = recientes.reverse();
    const refs = new Map(cronologicas.map((i, n) => [`#${n + 1}`, i.id]));
    const transcripcion = cronologicas
      .map(
        (i, n) =>
          `#${n + 1} ${i.direction === Direction.inbound ? 'Cliente' : 'Equipo'}: ` +
          i.content.slice(0, 500),
      )
      .join('\n');

    const actual = await this.get(leadId);
    const hechos =
      actual.facts.length > 0
        ? actual.facts.map((f) => `- ${f.clave}: ${f.valor}`).join('\n')
        : '(sin hechos registrados)';

    try {
      const raw = await this.anthropic.complete(
        INSIGHTS_SYSTEM,
        `RESUMEN:\n${actual.summary ?? '(todavía no hay resumen)'}\n\n` +
          `HECHOS REGISTRADOS:\n${hechos}\n\n` +
          `CONVERSACIÓN (cada mensaje con su referencia):\n${transcripcion}`,
        { background: true },
      );
      const insights = parseInsightsResponse(raw, refs);
      if (insights === null) {
        this.logger.warn(
          `Conclusiones ilegibles; se conservan las anteriores (leadId=${leadId})`,
        );
        return;
      }
      await this.save(leadId, { insights });
    } catch (error) {
      // Igual que el resumen: una mejora, no un requisito del turno.
      this.logger.warn(
        `No se pudieron rehacer las conclusiones (leadId=${leadId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * El trabajo de fondo completo. Si se juntaron suficientes mensajes nuevos,
   * rehace el resumen y después las conclusiones (que lo usan); siempre
   * indexa los mensajes que falten para la recuperación.
   */
  async refresh(leadId: string): Promise<void> {
    if (await this.needsSummary(leadId)) {
      await this.refreshSummary(leadId);
      await this.refreshInsights(leadId);
    }
    await this.recall.indexPending(leadId);
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
      insights?: Insight[];
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
        insights: data.insights ?? [],
        summarizedUpto: data.summarizedUpto ?? null,
      },
    });
  }
}
