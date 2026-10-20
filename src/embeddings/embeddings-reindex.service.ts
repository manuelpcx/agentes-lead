import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { textoParaIndexar } from '../memory/conversation-recall.service';
import { textoDeEjemplo } from '../improvement/example-library.service';
import { EmbeddingsService } from './embeddings.service';
import { EmbeddingsRateLimitError } from './providers/embeddings-provider.interface';

/** Vectores por lote: una petición al proveedor y otras tantas escrituras. */
export const REINDEX_BATCH = 100;
/** Espera antes de reintentar si el proveedor falló (p. ej. clave mal puesta). */
const REINTENTO_MS = 10 * 60_000;
const MAX_INTENTOS = 6;
/**
 * Ante un límite de uso (429) se espera un minuto y se repite el mismo lote:
 * los límites del proveedor son por minuto. Abortar y volver en 10 min no
 * avanzaría nunca con una cuota baja (p. ej. 3 peticiones por minuto).
 */
export const ESPERA_POR_LIMITE_MS = 60_000;
/** Esperas seguidas antes de rendirse y dejarlo para el reintento largo. */
export const MAX_ESPERAS_POR_LIMITE = 10;

/** Cuántos vectores se rehicieron, por tabla. */
export interface ReindexResult {
  fragmentos: number;
  ejemplos: number;
  interacciones: number;
}

/**
 * Rehace los vectores guardados con otro modelo de embeddings. Cambiar de
 * embedder (local → Voyage) deja todos los vectores viejos fuera de las
 * búsquedas, que solo comparan vectores del modelo activo; este servicio los
 * vuelve a calcular en segundo plano al arrancar.
 *
 * Es idempotente: cada escritura vuelve a comprobar que la fila siga siendo de
 * otro modelo, así que dos instancias a la vez solo gastan de más, no rompen
 * nada. Cruza empresas a propósito (cliente `raw`): es mantenimiento.
 */
@Injectable()
export class EmbeddingsReindexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingsReindexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** No bloquea el arranque: el panel y el agente funcionan mientras tanto. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    setImmediate(() => void this.correr(1));
  }

  private async correr(intento: number): Promise<void> {
    try {
      const r = await this.reindexAll();
      const total = r.fragmentos + r.ejemplos + r.interacciones;
      if (total > 0) {
        this.logger.log(
          `Vectores rehechos con ${this.embeddings.modelId}: ` +
            `${r.fragmentos} fragmentos, ${r.ejemplos} ejemplos, ` +
            `${r.interacciones} mensajes`,
        );
      }
    } catch (error) {
      const sigue = intento < MAX_INTENTOS;
      this.logger.warn(
        `No se pudo reindexar los embeddings (intento ${intento}): ` +
          `${(error as Error).message}` +
          (sigue
            ? '. Se reintenta en 10 min.'
            : '. Se reintenta al reiniciar.'),
      );
      if (sigue) {
        setTimeout(() => void this.correr(intento + 1), REINTENTO_MS).unref();
      }
    }
  }

  /** Recorre las tres tablas hasta que no quede ningún vector de otro modelo. */
  async reindexAll(): Promise<ReindexResult> {
    return {
      fragmentos: await this.porLotes(
        (m) => this.prisma.raw.$queryRaw<Array<{ id: string; texto: string }>>`
          SELECT id, content AS texto FROM "KnowledgeChunk"
          WHERE "embeddingModel" <> ${m} LIMIT ${REINDEX_BATCH}
        `,
        (f) => f.texto,
        (id, v, m) => this.prisma.raw.$executeRaw`
          UPDATE "KnowledgeChunk" SET embedding = ${v}::vector, "embeddingModel" = ${m}
          WHERE "embeddingModel" <> ${m} AND id = ${id}::uuid
        `,
      ),
      ejemplos: await this.porLotes(
        (m) => this.prisma.raw.$queryRaw<
          Array<{ id: string; situation: string; agentResponse: string }>
        >`
          SELECT id, situation, "agentResponse" FROM "ExampleLibrary"
          WHERE "embeddingModel" <> ${m} LIMIT ${REINDEX_BATCH}
        `,
        (f) => textoDeEjemplo(f.situation, f.agentResponse),
        (id, v, m) => this.prisma.raw.$executeRaw`
          UPDATE "ExampleLibrary" SET embedding = ${v}::vector, "embeddingModel" = ${m}
          WHERE "embeddingModel" <> ${m} AND id = ${id}::uuid
        `,
      ),
      interacciones: await this.porLotes(
        (m) => this.prisma.raw.$queryRaw<
          Array<{ id: string; direction: Direction; content: string }>
        >`
          SELECT e.id, i.direction, i.content FROM "InteractionEmbedding" e
          JOIN "Interaction" i ON i.id = e."interactionId"
          WHERE e."embeddingModel" <> ${m} LIMIT ${REINDEX_BATCH}
        `,
        (f) => textoParaIndexar(f),
        (id, v, m) => this.prisma.raw.$executeRaw`
          UPDATE "InteractionEmbedding" SET embedding = ${v}::vector, "embeddingModel" = ${m}
          WHERE "embeddingModel" <> ${m} AND id = ${id}::uuid
        `,
      ),
    };
  }

  /**
   * Embebe un lote esperando lo necesario si el proveedor pide calma. Solo la
   * reindexación hace esto: corre en segundo plano y no tiene apuro.
   */
  private async embedConPaciencia(textos: string[]): Promise<number[][]> {
    for (let esperas = 0; ; esperas++) {
      try {
        return await this.embeddings.embedDocuments(textos);
      } catch (error) {
        if (
          !(error instanceof EmbeddingsRateLimitError) ||
          esperas >= MAX_ESPERAS_POR_LIMITE
        ) {
          throw error;
        }
        await this.esperar(ESPERA_POR_LIMITE_MS);
      }
    }
  }

  /** Aparte para que los tests no esperen de verdad. */
  protected esperar(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms).unref());
  }

  /**
   * Lee un lote de filas de otro modelo, las embebe juntas y las escribe.
   * Termina cuando no quedan, o cuando un lote no escribió nada (otro proceso
   * se adelantó): así nunca gira en falso.
   */
  private async porLotes<F extends { id: string }>(
    leer: (modelo: string) => Promise<F[]>,
    texto: (fila: F) => string,
    escribir: (id: string, vector: string, modelo: string) => Promise<number>,
  ): Promise<number> {
    const modelo = this.embeddings.modelId;
    let total = 0;
    for (;;) {
      const filas = await leer(modelo);
      if (filas.length === 0) {
        return total;
      }
      const vectores = await this.embedConPaciencia(filas.map(texto));
      let escritas = 0;
      for (let n = 0; n < filas.length; n++) {
        escritas += await escribir(
          filas[n].id,
          `[${vectores[n].join(',')}]`,
          modelo,
        );
      }
      if (escritas === 0) {
        return total;
      }
      total += escritas;
    }
  }
}
