import { Injectable, Logger } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
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
import { mergeExtractedFacts, parseFactsResponse } from './fact-extraction';
import {
  REFRESH_EVERY_INTERACTIONS,
  SenalesDeRefresco,
  motivoDeRefresco,
  volvioTrasSilencio,
} from './refresh-triggers';
import {
  TOOL_DERIVAR_A_AGENTE,
  TOOL_ESCALAR_A_HUMANO,
  TOOL_REGISTRAR_PROMESA_PAGO,
} from '../agent/tools/tool-names';

/** Memoria de un lead tal como la consume el resto de la app. */
export interface LeadMemoryView {
  summary: string | null;
  facts: MemoryFact[];
  insights: Insight[];
  updatedAt: Date | null;
}

// Se re-exporta: otros módulos lo importan desde aquí.
export { REFRESH_EVERY_INTERACTIONS };

/** Acciones del agente que cambian la relación y justifican refrescar ya. */
const EVENTOS_CLAVE = [
  TOOL_ESCALAR_A_HUMANO,
  TOOL_REGISTRAR_PROMESA_PAGO,
  TOOL_DERIVAR_A_AGENTE,
];

/** Cuántas interacciones recientes se le pasan al modelo para resumir. */
const SUMMARY_WINDOW = 40;

const SUMMARY_SYSTEM = `Eres el archivista de un equipo comercial. Recibes lo que ya se sabía de una persona y la parte más reciente de su conversación, y devuelves un resumen ACTUALIZADO de quién es y en qué quedó la relación.

REGLAS:
- Escribe en español, en prosa, máximo 6 líneas. Sin encabezados ni viñetas.
- Solo lo que sirva para retomar la conversación: qué busca, qué le preocupa, qué se acordó, cómo prefiere que lo contacten, y el estado de la relación.
- NO incluyas cifras exactas, montos, precios ni fechas concretas. Di "mencionó un presupuesto acotado" o "pidió una fecha para la próxima semana", nunca el número ni el día.
- No inventes nada que no esté en el material. Si no hay nada relevante, devuelve una sola línea diciendo que aún no hay información útil.
- Devuelve SOLO el resumen, sin comillas ni texto adicional.`;

/** Cuántas interacciones recientes relee el modelo para extraer hechos. */
const FACTS_WINDOW = 40;

const FACTS_SYSTEM = `Eres el archivista de un equipo comercial y de cobranza. Recibes los hechos que ya están registrados sobre una persona y su conversación reciente, y anotas los datos DURADEROS que falten o hayan cambiado: lo que servirá para retomar la relación dentro de semanas.

QUÉ ANOTAR: qué producto o servicio le interesa, su objeción, quién decide, su plazo, su presupuesto, cómo y cuándo prefiere que la contacten (o por dónde no), si no es el titular, compromisos que asumió.

REGLAS:
- Solo lo que la persona dijo o dio a entender claramente. No inventes ni supongas.
- No repitas un hecho ya registrado con el mismo sentido. Si cambió, usa la MISMA clave con el valor nuevo.
- Nada del momento (saludos, "ahora estoy ocupado") ni datos sensibles: salud, religión, política, orientación sexual, origen étnico, contraseñas, números de tarjeta o cuenta.
- clave: corta, en minúsculas con guiones bajos (ej. "producto_de_interes", "horario_preferido").
- valor: una frase breve.
- importancia de 1 a 10: 9-10 compromisos y restricciones (promesa de pago, no contactar por un canal, no es el titular, quién decide); 6-8 datos del negocio (presupuesto, objeción, plazo, producto); 1-5 detalles prescindibles.
- Hasta 5 hechos. Si no hay nada nuevo, devuelve una lista vacía.

Responde SOLO con JSON válido, sin markdown:
{"hechos": [{"clave": "...", "valor": "...", "importancia": 7}]}`;

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

  /**
   * ¿Hay que rehacer la memoria? Cada `REFRESH_EVERY_INTERACTIONS` mensajes,
   * y antes si pasó algo que cambia la relación (ver `motivoDeRefresco`). Las
   * consultas de eventos solo corren cuando el conteo no alcanza a decidir.
   */
  private async needsSummary(leadId: string): Promise<boolean> {
    const row = await this.prisma.db.leadMemory.findFirst({
      where: { leadId },
      select: { summarizedUpto: true },
    });
    const desde = row?.summarizedUpto ?? null;
    const despues = desde ? { occurredAt: { gt: desde } } : {};
    const nuevas = await this.prisma.db.interaction.count({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS }, ...despues },
    });
    const base = {
      tieneResumen: desde !== null,
      nuevas,
      huboLlamada: false,
      huboEventoClave: false,
      volvioTrasSilencio: false,
    };
    // El conteo solo ya decide: sin mensajes, con muchos, o sin resumen aún.
    if (!desde || nuevas === 0 || nuevas >= REFRESH_EVERY_INTERACTIONS) {
      return this.decidir(leadId, base);
    }

    const llamadas = await this.prisma.db.interaction.count({
      where: { leadId, channel: Channel.call, ...despues },
    });
    const eventos = await this.prisma.db.agentAction.count({
      where: {
        leadId,
        tool: { in: EVENTOS_CLAVE },
        isError: false,
        ...despues,
      },
    });
    // Los nuevos más el último ya resumido, para medir el hueco entre ambos.
    const recientes = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      take: nuevas + 1,
      select: { direction: true, occurredAt: true },
    });
    return this.decidir(leadId, {
      ...base,
      huboLlamada: llamadas > 0,
      huboEventoClave: eventos > 0,
      volvioTrasSilencio: volvioTrasSilencio(recientes.reverse()),
    });
  }

  private decidir(leadId: string, senales: SenalesDeRefresco): boolean {
    const motivo = motivoDeRefresco(senales);
    if (motivo) {
      this.logger.log(`Refresco de memoria por ${motivo} (leadId=${leadId})`);
    }
    return motivo !== null;
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
   * Relee la conversación y anota los hechos duraderos que el agente no
   * guardó durante el turno. Se mezclan con los existentes sin degradar su
   * importancia (`mergeExtractedFacts`); si la respuesta no se puede leer, la
   * memoria queda como estaba.
   */
  async refreshFacts(leadId: string): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const recientes = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      take: FACTS_WINDOW,
      select: { direction: true, content: true, occurredAt: true },
    });
    if (recientes.length === 0) {
      return;
    }
    const transcripcion = recientes
      .reverse()
      .map(
        (i) =>
          `${i.direction === Direction.inbound ? 'Cliente' : 'Equipo'}: ` +
          i.content.slice(0, 500),
      )
      .join('\n');

    const actuales = parseFacts(await this.rawFacts(leadId));
    const hechos =
      actuales.length > 0
        ? actuales.map((f) => `- ${f.clave}: ${f.valor}`).join('\n')
        : '(sin hechos registrados)';

    try {
      const raw = await this.anthropic.complete(
        FACTS_SYSTEM,
        `HECHOS REGISTRADOS:\n${hechos}\n\n` +
          `CONVERSACIÓN RECIENTE:\n${transcripcion}`,
        { background: true },
      );
      const extraidos = parseFactsResponse(raw);
      if (extraidos === null) {
        this.logger.warn(
          `Hechos ilegibles; la memoria queda como estaba (leadId=${leadId})`,
        );
        return;
      }
      if (extraidos.length === 0) {
        return;
      }
      // Se relee justo antes de guardar: el agente pudo anotar algo mientras
      // el modelo respondía.
      const vigentes = parseFacts(await this.rawFacts(leadId));
      await this.save(leadId, {
        facts: mergeExtractedFacts(vigentes, extraidos),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudieron extraer hechos (leadId=${leadId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * El trabajo de fondo completo. Cuando toca (ver `needsSummary`), extrae
   * los hechos, rehace el resumen (que los usa) y después las conclusiones
   * (que usan ambos); siempre indexa los mensajes que falten para la
   * recuperación.
   */
  async refresh(leadId: string): Promise<void> {
    if (await this.needsSummary(leadId)) {
      await this.refreshFacts(leadId);
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
