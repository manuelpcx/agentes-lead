import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimit } from './rate-limit.decorator';
import {
  RateLimitGuard,
  RateLimitStore,
  clientIp,
  consume,
  rateLimitSubject,
} from './rate-limit.guard';

/** Redis de mentira: contadores con TTL en memoria. */
function fakeStore(): RateLimitStore & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    keys,
    incr: async (key) => {
      const next = (keys.get(key) ?? 0) + 1;
      keys.set(key, next);
      return next;
    },
    pexpire: async (key, ms) => {
      ttls.set(key, ms);
    },
    pttl: async (key) => ttls.get(key) ?? -1,
  };
}

function requestWith(
  headers: Record<string, string> = {},
  ip = '1.2.3.4',
): Request {
  return { headers, ip, socket: { remoteAddress: ip } } as unknown as Request;
}

function contextFor(
  handler: (...args: unknown[]) => unknown,
  req: Request,
  headersOut: Record<string, string> = {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class Demo {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({
        setHeader: (k: string, v: string) => {
          headersOut[k] = v;
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('consume', () => {
  it('cuenta y fija la ventana en la primera petición', async () => {
    const store = fakeStore();
    const hit = await consume(store, 'k', { limit: 3, windowSec: 60 });
    expect(hit).toEqual({ count: 1, retryAfterSec: 60 });
  });

  it('acumula dentro de la ventana', async () => {
    const store = fakeStore();
    const opts = { limit: 3, windowSec: 60 };
    await consume(store, 'k', opts);
    await consume(store, 'k', opts);
    const third = await consume(store, 'k', opts);
    expect(third.count).toBe(3);
  });

  it('vuelve a fijar el TTL si la clave quedó sin él', async () => {
    const store = fakeStore();
    store.keys.set('k', 5); // existe, pero sin TTL (pttl = -1)
    const hit = await consume(store, 'k', { limit: 3, windowSec: 30 });
    expect(hit.count).toBe(6);
    expect(hit.retryAfterSec).toBe(30);
  });
});

describe('clientIp', () => {
  it('toma la primera IP de X-Forwarded-For (la del cliente real)', () => {
    const req = requestWith({ 'x-forwarded-for': '203.0.113.9, 10.0.0.2' });
    expect(clientIp(req)).toBe('203.0.113.9');
  });

  it('cae a req.ip sin proxy', () => {
    expect(clientIp(requestWith({}, '198.51.100.7'))).toBe('198.51.100.7');
  });
});

describe('rateLimitSubject', () => {
  it('con scope auth cuenta por credencial, sin guardarla en claro', () => {
    const a = rateLimitSubject(
      requestWith({ authorization: 'Bearer tokenA' }),
      'auth',
    );
    const b = rateLimitSubject(
      requestWith({ authorization: 'Bearer tokenB' }),
      'auth',
    );
    expect(a).toMatch(/^auth:[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('tokenA');
  });

  it('con scope auth acepta también X-Api-Key', () => {
    const s = rateLimitSubject(requestWith({ 'x-api-key': 'ale_x' }), 'auth');
    expect(s).toMatch(/^auth:/);
  });

  it('con scope auth pero sin credencial cae a la IP', () => {
    expect(rateLimitSubject(requestWith({}, '9.9.9.9'), 'auth')).toBe(
      'ip:9.9.9.9',
    );
  });

  it('con scope ip ignora la credencial', () => {
    const s = rateLimitSubject(
      requestWith({ authorization: 'Bearer x' }, '9.9.9.9'),
      'ip',
    );
    expect(s).toBe('ip:9.9.9.9');
  });
});

describe('RateLimitGuard', () => {
  function buildGuard(store: RateLimitStore = fakeStore()) {
    return new RateLimitGuard(new Reflector(), store);
  }

  it('deja pasar las rutas sin @RateLimit sin tocar Redis', async () => {
    const store = fakeStore();
    const incr = jest.spyOn(store, 'incr');
    const guard = buildGuard(store);
    const sinLimite = () => undefined;

    await expect(
      guard.canActivate(contextFor(sinLimite, requestWith())),
    ).resolves.toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });

  it('permite hasta el límite y corta con 429 + Retry-After en la siguiente', async () => {
    const guard = buildGuard();
    const limitada = () => undefined;
    RateLimit({ limit: 2, windowSec: 60 })(limitada);
    const headers: Record<string, string> = {};

    await expect(
      guard.canActivate(contextFor(limitada, requestWith(), headers)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(limitada, requestWith(), headers)),
    ).resolves.toBe(true);
    expect(headers['X-RateLimit-Remaining']).toBe('0');

    await expect(
      guard.canActivate(contextFor(limitada, requestWith(), headers)),
    ).rejects.toMatchObject({ status: 429 });
    expect(headers['Retry-After']).toBe('60');
  });

  it('cuenta por separado a dos IPs distintas', async () => {
    const guard = buildGuard();
    const limitada = () => undefined;
    RateLimit({ limit: 1, windowSec: 60 })(limitada);

    await guard.canActivate(contextFor(limitada, requestWith({}, '1.1.1.1')));
    await expect(
      guard.canActivate(contextFor(limitada, requestWith({}, '2.2.2.2'))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(limitada, requestWith({}, '1.1.1.1'))),
    ).rejects.toThrow(HttpException);
  });

  it('si Redis falla, deja pasar (fail-open) en vez de tumbar la ruta', async () => {
    const roto: RateLimitStore = {
      incr: async () => {
        throw new Error('ECONNREFUSED');
      },
      pexpire: async () => undefined,
      pttl: async () => -1,
    };
    const guard = buildGuard(roto);
    const limitada = () => undefined;
    RateLimit({ limit: 1, windowSec: 60 })(limitada);

    await expect(
      guard.canActivate(contextFor(limitada, requestWith())),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(limitada, requestWith())),
    ).resolves.toBe(true);
  });
});
