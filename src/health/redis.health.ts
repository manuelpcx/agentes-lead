import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import type { EnvVars } from '../common/config/env.validation';

/** Verifica conectividad con Redis con un `PING`. */
@Injectable()
export class RedisHealthIndicator
  extends HealthIndicator
  implements OnModuleDestroy
{
  private readonly client: Redis;

  constructor(config: ConfigService<EnvVars, true>) {
    super();
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Railway usa red interna IPv6; ioredis resuelve IPv4 por defecto.
      // `family: 0` permite ambos (solo en prod, para no tocar dev local).
      ...(config.get('NODE_ENV') === 'production' ? { family: 0 } : {}),
    });
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      // Con `lazyConnect`, ioredis abre la conexión sola en el primer comando.
      // No llamamos `connect()` a mano (lanzaba "already connecting/connected"
      // cuando la conexión ya estaba en curso).
      const pong = await this.client.ping();
      return this.getStatus(key, pong === 'PONG');
    } catch (error) {
      throw new HealthCheckError(
        'Redis no disponible',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
