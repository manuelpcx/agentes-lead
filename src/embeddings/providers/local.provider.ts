import {
  EmbeddingsProvider,
  EmbeddingInputType,
} from './embeddings-provider.interface';

/** Similitud mínima del embedder local: solapamiento de palabras. */
export const LOCAL_MIN_SIMILARITY = 0.3;

/**
 * Embedder local determinista basado en *feature hashing* (hashing trick). No
 * es semántico como un modelo real, pero SÍ captura solapamiento léxico: textos
 * que comparten palabras quedan cerca en coseno. Suficiente para desarrollar y
 * testear el pipeline de RAG sin API key ni costo. Determinista ⇒ el mismo
 * texto produce siempre el mismo vector.
 */
export class LocalEmbeddingsProvider implements EmbeddingsProvider {
  readonly id: string;
  readonly minSimilarity: number;
  readonly recallMinSimilarity: number;

  constructor(
    readonly dimension: number,
    opciones: { minSimilarity?: number; recallMinSimilarity?: number } = {},
  ) {
    this.id = `local:${dimension}`;
    this.minSimilarity = opciones.minSimilarity ?? LOCAL_MIN_SIMILARITY;
    this.recallMinSimilarity =
      opciones.recallMinSimilarity ?? LOCAL_MIN_SIMILARITY;
  }

  async embed(
    texts: string[],
    _inputType?: EmbeddingInputType,
  ): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = this.tokenize(text);

    for (const token of tokens) {
      const bucket = this.hash(token, 2166136261) % this.dimension;
      // Segundo hash para el signo: reduce colisiones destructivas.
      const sign = (this.hash(token, 963157) & 1) === 0 ? 1 : -1;
      vector[bucket] += sign;
    }

    return this.l2Normalize(vector);
  }

  /** Divide en tokens en minúsculas (soporta acentos y ñ). */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFC')
      .split(/[^0-9a-záéíóúüñ]+/i)
      .filter((t) => t.length > 0);
  }

  /** FNV-1a de 32 bits con offset configurable. */
  private hash(str: string, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** Normaliza a norma L2 = 1 (vector unitario) para coseno estable. */
  private l2Normalize(vector: number[]): number[] {
    let sumSquares = 0;
    for (const v of vector) {
      sumSquares += v * v;
    }
    const norm = Math.sqrt(sumSquares);
    if (norm === 0) {
      return vector;
    }
    return vector.map((v) => v / norm);
  }
}
