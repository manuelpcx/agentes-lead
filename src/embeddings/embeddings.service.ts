import { Inject, Injectable } from '@nestjs/common';
import {
  EMBEDDINGS_PROVIDER,
  EmbeddingsProvider,
} from './providers/embeddings-provider.interface';

/**
 * Fachada de embeddings. El resto del sistema depende de este servicio, no del
 * proveedor concreto (Voyage / local), que se resuelve por configuración.
 */
@Injectable()
export class EmbeddingsService {
  constructor(
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly provider: EmbeddingsProvider,
  ) {}

  /** Dimensión de los vectores (debe coincidir con la columna `vector` en BD). */
  get dimension(): number {
    return this.provider.dimension;
  }

  /** Embeddings para fragmentos de documentos (indexación). */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts, 'document');
  }

  /** Embedding de una consulta de búsqueda. */
  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.provider.embed([text], 'query');
    return vector;
  }
}
