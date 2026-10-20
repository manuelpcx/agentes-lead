import { EmbeddingsProvider } from './embeddings-provider.interface';
import { LocalEmbeddingsProvider } from './local.provider';
import { VoyageEmbeddingsProvider } from './voyage.provider';

/** Lo que hace falta para armar el proveedor (las variables `EMBEDDINGS_*`). */
export interface EmbeddingsSettings {
  provider: 'local' | 'voyage';
  model: string;
  dimension: number;
  voyageApiKey?: string;
  /** Sin valor, el umbral calibrado de cada proveedor. */
  minSimilarity?: number;
  /** Igual, para los mensajes viejos de la conversación. */
  recallMinSimilarity?: number;
}

/**
 * Elige el proveedor según la configuración. Lo usan la app, el banco de
 * evaluaciones y el script de calibración, para que los tres midan el mismo
 * embedder que producción.
 */
export function buildEmbeddingsProvider(
  s: EmbeddingsSettings,
): EmbeddingsProvider {
  if (s.provider === 'voyage') {
    if (!s.voyageApiKey) {
      throw new Error('Falta VOYAGE_API_KEY para EMBEDDINGS_PROVIDER=voyage');
    }
    return new VoyageEmbeddingsProvider(s.voyageApiKey, s.model, s.dimension, {
      minSimilarity: s.minSimilarity,
      recallMinSimilarity: s.recallMinSimilarity,
    });
  }
  return new LocalEmbeddingsProvider(s.dimension, {
    minSimilarity: s.minSimilarity,
    recallMinSimilarity: s.recallMinSimilarity,
  });
}

/** Lee la configuración del entorno, con los mismos valores por defecto. */
export function embeddingsSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingsSettings {
  const numero = (v?: string) => (v ? Number(v) : undefined);
  return {
    provider: env.EMBEDDINGS_PROVIDER === 'voyage' ? 'voyage' : 'local',
    model: env.EMBEDDINGS_MODEL || 'voyage-3.5',
    dimension: Number(env.EMBEDDINGS_DIMENSION || 1024),
    voyageApiKey: env.VOYAGE_API_KEY,
    minSimilarity: numero(env.EMBEDDINGS_MIN_SIMILARITY),
    recallMinSimilarity: numero(env.EMBEDDINGS_RECALL_MIN_SIMILARITY),
  };
}
