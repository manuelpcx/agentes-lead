/** Tipo de entrada para proveedores que distinguen documento vs. consulta. */
export type EmbeddingInputType = 'document' | 'query';

/**
 * El proveedor rechazó por límite de uso (429) y sus reintentos cortos no
 * alcanzaron. Pasajero: quien pueda esperar (la reindexación) espera y
 * reintenta; un turno sigue sin embeddings.
 */
export class EmbeddingsRateLimitError extends Error {}

/** Token de inyección del proveedor de embeddings activo. */
export const EMBEDDINGS_PROVIDER = Symbol('EMBEDDINGS_PROVIDER');

/**
 * Contrato de un proveedor de embeddings. Permite intercambiar Voyage AI por un
 * embedder local (dev) sin tocar el resto del sistema.
 */
export interface EmbeddingsProvider {
  /** Dimensión de los vectores producidos (debe coincidir con la columna BD). */
  readonly dimension: number;

  /**
   * Qué produjo el vector (`local:1024`, `voyage:voyage-3.5:1024`). Se guarda
   * junto a cada vector: dos modelos distintos no son comparables, así que
   * solo se busca entre los del modelo activo y el resto se reindexa.
   */
  readonly id: string;

  /**
   * Similitud coseno desde la que un fragmento de la base de conocimiento
   * cuenta como parecido. Cada embedder reparte los puntajes distinto: el 0,3
   * del local es ruido en uno semántico.
   */
  readonly minSimilarity: number;

  /**
   * Lo mismo para los mensajes viejos de la conversación. Va aparte porque un
   * mensaje corto puntúa bastante menos que un párrafo, aun respondiendo
   * igual de bien (`npm run embeddings:calibrar`).
   */
  readonly recallMinSimilarity: number;

  /**
   * Convierte textos en vectores. `inputType` optimiza recuperación en
   * proveedores que lo soportan (Voyage); otros lo ignoran.
   */
  embed(texts: string[], inputType?: EmbeddingInputType): Promise<number[][]>;
}
