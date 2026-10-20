import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { EmbeddingsService } from './embeddings.service';
import { EmbeddingsReindexService } from './embeddings-reindex.service';
import {
  EMBEDDINGS_PROVIDER,
  EmbeddingsProvider,
} from './providers/embeddings-provider.interface';
import { buildEmbeddingsProvider } from './providers/build-provider';

/**
 * Módulo global de embeddings. Selecciona el proveedor según configuración:
 * 'local' (determinista, sin API key) o 'voyage' (Voyage AI). Global para que
 * la base de conocimiento y el agente lo usen sin re-importarlo.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDINGS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>): EmbeddingsProvider =>
        // La validación de entorno garantiza la key cuando provider=voyage.
        buildEmbeddingsProvider({
          provider: config.get('EMBEDDINGS_PROVIDER', { infer: true }),
          model: config.get('EMBEDDINGS_MODEL', { infer: true }),
          dimension: config.get('EMBEDDINGS_DIMENSION', { infer: true }),
          voyageApiKey: config.get('VOYAGE_API_KEY', { infer: true }),
          minSimilarity: config.get('EMBEDDINGS_MIN_SIMILARITY', {
            infer: true,
          }),
          recallMinSimilarity: config.get('EMBEDDINGS_RECALL_MIN_SIMILARITY', {
            infer: true,
          }),
        }),
    },
    EmbeddingsService,
    // Al arrancar, rehace los vectores que quedaron de otro modelo.
    EmbeddingsReindexService,
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
