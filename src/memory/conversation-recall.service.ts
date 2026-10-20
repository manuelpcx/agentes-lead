import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CONVERSATION_CHANNELS } from '../agent/agent.constants';
import { HISTORY_LIMIT } from '../agent/conversation-history';

/**
 * Recuperación de mensajes antiguos por relevancia (la "memoria" de
 * *Generative Agents*): el modelo ve los últimos `HISTORY_LIMIT` mensajes, y lo
 * anterior solo sobrevive en el resumen, que por regla no guarda cifras ni
 * fechas. Esto trae de vuelta los pocos mensajes viejos que se parecen a lo
 * que el cliente acaba de escribir.
 */

/** Cuántos mensajes antiguos se traen como máximo por turno. */
export const RECALL_TOP_K = 4;
/**
 * Umbral de similitud por defecto (el del embedder local). En producción manda
 * el del embedder activo (`EmbeddingsService.recallMinSimilarity`).
 */
export const RECALL_MIN_SIMILARITY = 0.3;
/** O bien: comparte al menos la mitad de las palabras clave de la consulta. */
export const RECALL_MIN_COBERTURA = 0.5;
/** Candidatos que trae el SQL por vector, antes de combinar con las palabras clave. */
const RECALL_CANDIDATOS = 20;
/** Tope de interacciones por indexación (acota el costo de un lead con mucho historial). */
export const MAX_INDEX_BATCH = 100;
/** Se embebe el comienzo del mensaje: una transcripción larga no aporta más. */
const MAX_EMBED_CHARS = 2_000;

/** Una interacción antigua recuperada por parecerse a lo último que se dijo. */
export interface RecalledInteraction {
  id: string;
  direction: Direction;
  channel: Channel;
  content: string;
  occurredAt: Date;
  metadata?: unknown;
  similarity: number;
}

/**
 * Filtra por umbral, se queda con los `RECALL_TOP_K` más parecidos y los
 * devuelve en orden cronológico, que es como se leen en una conversación.
 */
/**
 * Palabras que no dicen de qué se habla (sin tildes). Sin sacarlas, un "hola"
 * o un "para" emparejan cualquier mensaje con cualquier otro.
 */
const PALABRAS_VACIAS = new Set(
  (
    'a al algo alguna alguno ante asi aun bien bueno buena buenas buenos cada ' +
    'como con cual cuales cuando cuanta cuantas cuanto cuantos de del desde dia ' +
    'dias donde dos el ella ellas ello ellos en entonces era eran eres es esa ' +
    'esas ese eso esos esta estas este esto estos estoy estamos fue gracias ha ' +
    'han hay hola la las le les lo los mas me mi mis mucho muy nada ni no nos ' +
    'nosotros o ok okay otra otro para pero poco por porque pues que quien se ' +
    'sea ser si sin sobre solo son su sus tal tambien te tengo tiene tienen todo ' +
    'todos tu tus un una uno unos unas vale y ya yo tardes noches cliente equipo ' +
    'dale listo claro aqui aca alla ahi hoy ayer manana puedo puede puedes ' +
    'quiero quieres necesito hacer saber decir ver ir voy vamos somos'
  ).split(' '),
);

/**
 * Las palabras que dicen de qué trata un texto: en minúsculas, sin tildes, sin
 * palabras vacías, y con los plurales simples reducidos ("sucursales" →
 * "sucursal") para que el singular y el plural calcen.
 */
export function palabrasClave(texto: string): string[] {
  const vistas = new Set<string>();
  for (const token of texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)) {
    if (token.length < 3 || PALABRAS_VACIAS.has(token)) {
      continue;
    }
    const raiz =
      token.length > 4 && token.endsWith('es')
        ? token.slice(0, -2)
        : token.length > 3 && token.endsWith('s')
          ? token.slice(0, -1)
          : token;
    vistas.add(raiz);
  }
  return [...vistas];
}

/** Qué fracción de las palabras clave de la consulta aparece en el texto. */
function coberturaLexica(claves: string[], texto: string): number {
  if (claves.length === 0) {
    return 0;
  }
  const delTexto = new Set(palabrasClave(texto));
  return claves.filter((c) => delTexto.has(c)).length / claves.length;
}

/**
 * Elige los recuerdos con un criterio híbrido: entra lo que se parece por el
 * vector (`RECALL_MIN_SIMILARITY`) **o** lo que comparte la mitad de las
 * palabras clave de la consulta (`RECALL_MIN_COBERTURA`). El vector capta el
 * sentido (con un embedder semántico); las palabras clave, el término exacto,
 * que el embedder local apenas ve en mensajes cortos. Se quedan los
 * `RECALL_TOP_K` mejores, en orden cronológico, como se lee una conversación.
 */
export function seleccionarRecuerdos(
  candidatos: RecalledInteraction[],
  query: string,
  minSimilarity = RECALL_MIN_SIMILARITY,
): RecalledInteraction[] {
  const claves = palabrasClave(query);
  return candidatos
    .map((c) => ({ c, cobertura: coberturaLexica(claves, c.content) }))
    .filter(
      ({ c, cobertura }) =>
        c.similarity >= minSimilarity || cobertura >= RECALL_MIN_COBERTURA,
    )
    .sort(
      (a, b) =>
        Math.max(b.c.similarity, b.cobertura) -
        Math.max(a.c.similarity, a.cobertura),
    )
    .slice(0, RECALL_TOP_K)
    .map(({ c }) => c)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** Lo que se embebe de una interacción: quién habló y qué dijo. */
export function textoParaIndexar(i: {
  direction: Direction;
  content: string;
}): string {
  const quien = i.direction === Direction.inbound ? 'Cliente' : 'Equipo';
  return `${quien}: ${i.content.slice(0, MAX_EMBED_CHARS)}`;
}

interface RawRecalled {
  id: string;
  direction: Direction;
  channel: Channel;
  content: string;
  occurredAt: Date;
  metadata: unknown;
  similarity: number | string;
}

@Injectable()
export class ConversationRecallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * Sin vector, o con uno de otro modelo: los dos hay que (re)indexarlos. Un
   * vector de otro embedder no se puede comparar con los del activo.
   */
  private sinVectorVigente() {
    return [
      { embedding: { is: null } },
      {
        embedding: {
          is: { embeddingModel: { not: this.embeddings.modelId } },
        },
      },
    ];
  }

  /**
   * Embebe, en un solo lote, las interacciones de conversación del lead que
   * todavía no tienen un vector del modelo activo (las más nuevas primero,
   * hasta `MAX_INDEX_BATCH`). Corre en segundo plano. Devuelve cuántas indexó.
   */
  async indexPending(leadId: string): Promise<number> {
    const companyId = TenantContext.requireCompanyId();
    const pendientes = await this.prisma.db.interaction.findMany({
      where: {
        leadId,
        channel: { in: CONVERSATION_CHANNELS },
        OR: this.sinVectorVigente(),
      },
      orderBy: { occurredAt: 'desc' },
      take: MAX_INDEX_BATCH,
      select: { id: true, direction: true, content: true },
    });
    if (pendientes.length === 0) {
      return 0;
    }

    const modelo = this.embeddings.modelId;
    const vectores = await this.embeddings.embedDocuments(
      pendientes.map(textoParaIndexar),
    );
    for (let n = 0; n < pendientes.length; n++) {
      const vector = `[${vectores[n].join(',')}]`;
      // pgvector no pasa por Prisma: SQL crudo con companyId explícito. Si ya
      // había un vector de otro modelo, se reemplaza; si otro proceso ya la
      // indexó con este mismo, queda como está.
      await this.prisma.raw.$executeRaw`
        INSERT INTO "InteractionEmbedding" ("id", "companyId", "leadId", "interactionId", "embedding", "embeddingModel")
        VALUES (gen_random_uuid(), ${companyId}::uuid, ${leadId}::uuid, ${pendientes[n].id}::uuid, ${vector}::vector, ${modelo})
        ON CONFLICT ("interactionId") DO UPDATE
          SET "embedding" = EXCLUDED."embedding", "embeddingModel" = EXCLUDED."embeddingModel"
          WHERE "InteractionEmbedding"."embeddingModel" <> EXCLUDED."embeddingModel"
      `;
    }
    return pendientes.length;
  }

  /**
   * ¿Hay mensajes sin indexar que ya salieron de la ventana de historial? Es
   * lo que deja a un lead antiguo sin recuperación: sus mensajes viejos son
   * anteriores a esta función. Lo nuevo se indexa con el refresco periódico.
   */
  async needsIndexing(leadId: string): Promise<boolean> {
    const ventana = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { occurredAt: true },
    });
    if (ventana.length < HISTORY_LIMIT) {
      return false; // todo el historial cabe en la ventana
    }
    const limite = ventana[ventana.length - 1].occurredAt;
    const sinIndexar = await this.prisma.db.interaction.count({
      where: {
        leadId,
        channel: { in: CONVERSATION_CHANNELS },
        occurredAt: { lt: limite },
        OR: this.sinVectorVigente(),
      },
    });
    return sinIndexar > 0;
  }

  /**
   * Los mensajes anteriores a `before` (el más antiguo de la ventana) que más
   * se parecen a `query`. Nunca "basura": si nada supera el umbral, `[]`.
   */
  async recall(
    leadId: string,
    query: string,
    before: Date,
  ): Promise<RecalledInteraction[]> {
    // Sin palabras clave ("hola", "ok") no hay de qué acordarse: solo
    // traería saludos viejos.
    if (palabrasClave(query).length === 0) {
      return [];
    }
    const companyId = TenantContext.requireCompanyId();
    const modelo = this.embeddings.modelId;
    const vector = `[${(await this.embeddings.embedQuery(query)).join(',')}]`;

    const filas = await this.prisma.raw.$queryRaw<RawRecalled[]>`
      SELECT i.id, i.direction, i.channel, i.content, i."occurredAt", i.metadata,
             1 - (e.embedding <=> ${vector}::vector) AS similarity
      FROM "InteractionEmbedding" e
      JOIN "Interaction" i ON i.id = e."interactionId"
      WHERE e."companyId" = ${companyId}::uuid
        AND e."leadId" = ${leadId}::uuid
        AND e."embeddingModel" = ${modelo}
        AND i."occurredAt" < ${before}
      ORDER BY e.embedding <=> ${vector}::vector
      LIMIT ${RECALL_CANDIDATOS}
    `;

    return seleccionarRecuerdos(
      filas.map((f) => ({ ...f, similarity: Number(f.similarity) })),
      query,
      this.embeddings.recallMinSimilarity,
    );
  }
}
