import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { REDIS_CLIENT } from '../common/rate-limit/rate-limit.guard';

/**
 * Lo mínimo que necesitamos de ioredis para el candado. Tenerlo como interfaz
 * propia permite probar el servicio sin levantar Redis.
 */
export interface LockStore {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    condition: 'NX',
  ): Promise<string | null>;
  eval(
    script: string,
    numKeys: number,
    key: string,
    token: string,
  ): Promise<unknown>;
}

/**
 * Libera el candado SOLO si sigue siendo nuestro. Sin esta comparación, un
 * turno que se pasó del TTL borraría el candado que ya tomó otro turno.
 */
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then ' +
  'return redis.call("del", KEYS[1]) else return 0 end';

function lockKey(leadId: string): string {
  return `agent-turn-lock:${leadId}`;
}

/**
 * Candado por lead: garantiza que nunca corran dos turnos del mismo lead a la
 * vez. Antes no existía y el worker atendía 4 turnos en paralelo, así que una
 * ráfaga de mensajes del cliente podía producir varias respuestas simultáneas
 * (y contradictorias, porque cada turno armaba su contexto por separado).
 *
 * Es un candado con TTL, no un mutex perfecto: si el proceso muere a mitad de
 * turno, el TTL lo libera solo en vez de dejar al lead bloqueado para siempre.
 */
@Injectable()
export class TurnLockService {
  private readonly logger = new Logger(TurnLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly store: LockStore) {}

  /**
   * Toma el candado del lead. Devuelve el token con el que liberarlo, o null si
   * otro turno del mismo lead lo tiene tomado.
   *
   * Si Redis no responde, falla ABIERTO (devuelve token igual): quedarse sin
   * contestarle al cliente es peor que arriesgar dos turnos solapados, que es
   * justamente lo que pasaba siempre antes de este candado.
   */
  async acquire(leadId: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    try {
      const ok = await this.store.set(
        lockKey(leadId),
        token,
        'PX',
        ttlMs,
        'NX',
      );
      return ok ? token : null;
    } catch (error) {
      this.logger.warn(
        `Redis no respondió al tomar el candado del lead ${leadId} ` +
          `(${(error as Error).message}): el turno sigue igual`,
      );
      return token;
    }
  }

  /** Libera el candado si sigue siendo de este turno. */
  async release(leadId: string, token: string): Promise<void> {
    try {
      await this.store.eval(RELEASE_SCRIPT, 1, lockKey(leadId), token);
    } catch (error) {
      // No es grave: el TTL lo libera igual, solo con más demora.
      this.logger.warn(
        `No se pudo liberar el candado del lead ${leadId}: ` +
          `${(error as Error).message}`,
      );
    }
  }
}
