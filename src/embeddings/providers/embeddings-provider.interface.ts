/** Tipo de entrada para proveedores que distinguen documento vs. consulta. */
export type EmbeddingInputType = 'document' | 'query';

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
   * Convierte textos en vectores. `inputType` optimiza recuperación en
   * proveedores que lo soportan (Voyage); otros lo ignoran.
   */
  embed(texts: string[], inputType?: EmbeddingInputType): Promise<number[][]>;
}
