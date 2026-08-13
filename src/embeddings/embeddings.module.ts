import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { EmbeddingsService } from './embeddings.service';
import {
  EMBEDDINGS_PROVIDER,
  EmbeddingsProvider,
} from './providers/embeddings-provider.interface';
import { LocalEmbeddingsProvider } from './providers/local.provider';
import { VoyageEmbeddingsProvider } from './providers/voyage.provider';

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
      useFactory: (
        config: ConfigService<EnvVars, true>,
      ): EmbeddingsProvider => {
        const dimension = config.get('EMBEDDINGS_DIMENSION', { infer: true });
        const provider = config.get('EMBEDDINGS_PROVIDER', { infer: true });

        if (provider === 'voyage') {
          // La validación de entorno garantiza la key cuando provider=voyage.
          const apiKey = config.get('VOYAGE_API_KEY', {
            infer: true,
          }) as string;
          const model = config.get('EMBEDDINGS_MODEL', { infer: true });
          return new VoyageEmbeddingsProvider(apiKey, model, dimension);
        }
        return new LocalEmbeddingsProvider(dimension);
      },
    },
    EmbeddingsService,
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
