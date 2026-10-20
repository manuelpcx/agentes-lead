import { Logger } from '@nestjs/common';
import {
  EmbeddingsProvider,
  EmbeddingInputType,
} from './embeddings-provider.interface';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Textos por petición. Voyage acepta hasta 1.000 y 320K tokens (voyage-3.5);
 * con mensajes de hasta 2.000 caracteres, 128 queda lejos de ambos topes.
 */
export const VOYAGE_BATCH_SIZE = 128;
/** Intentos por lote: el primero y dos reintentos. */
const MAX_INTENTOS = 3;
/** Corta una petición colgada en vez de bloquear el trabajo de fondo. */
const TIMEOUT_MS = 30_000;
/**
 * Umbrales por defecto, calibrados con `npm run embeddings:calibrar` sobre
 * voyage-3.5 (2026-10-20, 6 pares por grupo; ordenó bien los 12). Son pisos
 * justo bajo lo relevante más bajo: conocimiento desde 0,577, mensajes desde
 * 0,316. Lo ajeno llega hasta 0,576 y 0,423, pero la búsqueda toma primero lo
 * más parecido, así que solo entra si no hay nada mejor.
 */
export const VOYAGE_MIN_SIMILARITY = 0.55;
export const VOYAGE_RECALL_MIN_SIMILARITY = 0.3;

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/** Un error en el que reintentar no sirve (clave inválida, petición mala). */
class ErrorDefinitivo extends Error {}

/**
 * Proveedor de embeddings contra Voyage AI (recomendado por Anthropic). Usa
 * `input_type` para optimizar recuperación (documentos vs. consultas) y pide
 * la dimensión exacta de la columna `vector` de la base.
 */
export class VoyageEmbeddingsProvider implements EmbeddingsProvider {
  private readonly logger = new Logger(VoyageEmbeddingsProvider.name);
  readonly id: string;
  readonly minSimilarity: number;
  readonly recallMinSimilarity: number;
  private readonly esperaMs: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    readonly dimension: number,
    opciones: {
      esperaMs?: number;
      minSimilarity?: number;
      recallMinSimilarity?: number;
    } = {},
  ) {
    this.id = `voyage:${model}:${dimension}`;
    this.esperaMs = opciones.esperaMs ?? 1_000;
    this.minSimilarity = opciones.minSimilarity ?? VOYAGE_MIN_SIMILARITY;
    this.recallMinSimilarity =
      opciones.recallMinSimilarity ?? VOYAGE_RECALL_MIN_SIMILARITY;
  }

  async embed(
    texts: string[],
    inputType: EmbeddingInputType = 'document',
  ): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_BATCH_SIZE) {
      out.push(
        ...(await this.embedLote(
          texts.slice(i, i + VOYAGE_BATCH_SIZE),
          inputType,
        )),
      );
    }
    return out;
  }

  private async embedLote(
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<number[][]> {
    for (let intento = 1; ; intento++) {
      try {
        return await this.pedir(texts, inputType);
      } catch (error) {
        if (error instanceof ErrorDefinitivo || intento >= MAX_INTENTOS) {
          throw error;
        }
        // Espera creciente: 1 s, 2 s. Un 429 suele pasar en segundos.
        await new Promise((r) => setTimeout(r, this.esperaMs * intento));
      }
    }
  }

  private async pedir(
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<number[][]> {
    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        input_type: inputType,
        output_dimension: this.dimension,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Voyage respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      const mensaje = `Fallo al generar embeddings (Voyage ${response.status})`;
      // 429 (límite de uso) y 5xx son pasajeros; el resto no va a cambiar.
      const pasajero = response.status === 429 || response.status >= 500;
      throw pasajero ? new Error(mensaje) : new ErrorDefinitivo(mensaje);
    }

    const json = (await response.json()) as VoyageResponse;
    // Voyage devuelve en orden, pero ordenamos por `index` por seguridad.
    const vectores = json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    if (vectores.some((v) => v.length !== this.dimension)) {
      throw new ErrorDefinitivo(
        `Voyage devolvió vectores de otra dimensión (se esperaba ${this.dimension})`,
      );
    }
    return vectores;
  }
}
