import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { REDIS_CLIENT } from '../common/rate-limit/rate-limit.guard';

/** Lo mínimo de ioredis que usa el contador (así se prueba sin Redis). */
export interface QuotaStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/** El contador vive dos días: alcanza para el día UTC en curso. */
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

/**
 * Tope diario de correos por empresa que salen por la cuenta de Resend de la
 * plataforma. Todas las empresas comparten esa cuenta: sin tope, una campaña
 * mal armada de un cliente podría hacer que Resend la suspenda para todos.
 * Cuenta por día UTC. Si Redis no responde, deja pasar (igual que el
 * limitador de peticiones): un problema de Redis no puede cortar el correo.
 */
@Injectable()
export class EmailQuotaService {
  private readonly logger = new Logger(EmailQuotaService.name);
  readonly limit: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly store: QuotaStore,
    config: ConfigService<EnvVars, true>,
  ) {
    this.limit = config.get('EMAIL_DAILY_LIMIT_PER_COMPANY', { infer: true });
  }

  /** Cuenta un envío. `allowed: false` si con este se pasa del tope. */
  async consume(companyId: string, now = new Date()): Promise<QuotaResult> {
    const key = this.key(companyId, now);
    try {
      const used = await this.store.incr(key);
      if (used === 1) {
        await this.store.expire(key, KEY_TTL_SECONDS);
      }
      return { allowed: used <= this.limit, used, limit: this.limit };
    } catch (e) {
      this.logger.warn(
        `Contador de correos sin Redis (${(e as Error).message}): se deja pasar.`,
      );
      return { allowed: true, used: 0, limit: this.limit };
    }
  }

  /** Correos enviados hoy por la empresa (0 si Redis no responde). */
  async used(companyId: string, now = new Date()): Promise<number> {
    try {
      return Number((await this.store.get(this.key(companyId, now))) ?? 0);
    } catch {
      return 0;
    }
  }

  private key(companyId: string, now: Date): string {
    return `email-quota:${companyId}:${now.toISOString().slice(0, 10)}`;
  }
}
