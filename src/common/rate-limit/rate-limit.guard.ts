import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

/** Token de inyección del cliente Redis compartido (ver `RateLimitModule`). */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Lo mínimo que necesitamos de ioredis — así el guard se prueba sin Redis. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
}

export interface RateLimitHit {
  /** Peticiones contadas en la ventana actual, incluida esta. */
  count: number;
  /** Segundos hasta que la ventana se reinicia. */
  retryAfterSec: number;
}

/** Cada cuánto, como máximo, se avisa en logs que Redis no responde. */
const REDIS_WARN_INTERVAL_MS = 60_000;

/**
 * Cuenta una petición en la ventana fija de `key`. INCR es atómico, así que
 * exactamente una de las peticiones concurrentes ve el `1` y fija el TTL.
 */
export async function consume(
  store: RateLimitStore,
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitHit> {
  const windowMs = options.windowSec * 1000;
  const count = await store.incr(key);
  let ttl = await store.pttl(key);
  // -1 = existe sin TTL (primera petición, o un proceso murió entre el INCR y
  // el PEXPIRE): se fija ahora para que la ventana siempre se cierre.
  if (count === 1 || ttl < 0) {
    await store.pexpire(key, windowMs);
    ttl = windowMs;
  }
  return { count, retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)) };
}

/**
 * IP de origen. Detrás del proxy del PaaS (Railway) la real viene en
 * `X-Forwarded-For` — la primera de la lista es el cliente.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]
    ?.trim();
  return first || req.ip || req.socket?.remoteAddress || 'desconocida';
}

/** Por quién se cuenta esta petición, según el `scope` del decorador. */
export function rateLimitSubject(
  req: Request,
  scope: RateLimitOptions['scope'],
): string {
  if (scope === 'auth') {
    const header = req.headers.authorization ?? req.headers['x-api-key'];
    const credential = Array.isArray(header) ? header[0] : header;
    if (credential) {
      // Solo un hash parcial: la credencial en sí nunca entra a Redis.
      const hash = createHash('sha256').update(credential).digest('hex');
      return `auth:${hash.slice(0, 16)}`;
    }
  }
  return `ip:${clientIp(req)}`;
}

/**
 * Guard global de limitación de tasa. Solo actúa en rutas con `@RateLimit`;
 * el resto pasa sin tocar Redis.
 *
 * Es de ventana fija sobre Redis (INCR + PEXPIRE): simple, atómico y
 * compartido entre instancias. Si Redis no responde, **deja pasar** y avisa:
 * un limitador caído no debe tumbar la API entera — pero tampoco debe
 * fallar en silencio.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private lastRedisWarnAt = 0;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      RateLimitOptions | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const key = `rl:${context.getClass().name}.${context.getHandler().name}:${rateLimitSubject(req, options.scope)}`;

    let hit: RateLimitHit;
    try {
      hit = await consume(this.store, key, options);
    } catch (error) {
      this.warnRedisDown(error);
      return true;
    }

    res.setHeader('X-RateLimit-Limit', String(options.limit));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, options.limit - hit.count)),
    );
    if (hit.count > options.limit) {
      res.setHeader('Retry-After', String(hit.retryAfterSec));
      throw new HttpException(
        'Demasiadas peticiones. Espera un momento e intenta de nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private warnRedisDown(error: unknown): void {
    const now = Date.now();
    if (now - this.lastRedisWarnAt < REDIS_WARN_INTERVAL_MS) {
      return;
    }
    this.lastRedisWarnAt = now;
    this.logger.warn(
      `Redis no responde: la limitación de tasa queda DESACTIVADA mientras tanto (${(error as Error)?.message ?? error}).`,
    );
  }
}
