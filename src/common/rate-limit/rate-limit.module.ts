import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import type { EnvVars } from '../config/env.validation';
import { isLocalRedis } from '../redis.util';
import { RateLimitGuard, REDIS_CLIENT } from './rate-limit.guard';

/** Cada cuánto, como máximo, se loguea un error de conexión de Redis. */
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Limitación de tasa global. Abre UNA conexión a Redis para el guard (BullMQ
 * tiene las suyas) y registra `RateLimitGuard` como guard de toda la app:
 * solo actúa en las rutas marcadas con `@RateLimit`.
 *
 * Sin `@nestjs/throttler` a propósito: no se pueden instalar dependencias en
 * este árbol (conflicto npm/pnpm), y con Redis a mano el guard son 60 líneas.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => {
        const url = config.get('REDIS_URL');
        const client = new Redis(url, {
          // Un reintento y a fallar: el guard deja pasar si Redis no responde,
          // pero no puede quedarse esperando y frenar la petición.
          maxRetriesPerRequest: 1,
          connectTimeout: 5_000,
          // Railway usa red interna IPv6; ioredis resuelve IPv4 por defecto.
          // `family: 0` permite ambos; se omite solo en localhost (dev).
          ...(isLocalRedis(url) ? {} : { family: 0 }),
        });
        // ioredis reintenta solo; sin este handler cada fallo sería un
        // "unhandled error" ruidoso. Se loguea acotado.
        const logger = new Logger('RateLimitRedis');
        let lastLogAt = 0;
        client.on('error', (error: Error) => {
          const now = Date.now();
          if (now - lastLogAt > ERROR_LOG_INTERVAL_MS) {
            lastLogAt = now;
            logger.warn(`Conexión Redis del limitador: ${error.message}`);
          }
        });
        return client;
      },
    },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [REDIS_CLIENT],
})
export class RateLimitModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
