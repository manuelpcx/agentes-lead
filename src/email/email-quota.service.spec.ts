import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { EmailQuotaService, QuotaStore } from './email-quota.service';

function build(store: Partial<Record<keyof QuotaStore, jest.Mock>>, limit = 3) {
  const config = {
    get: () => limit,
  } as unknown as ConfigService<EnvVars, true>;
  return new EmailQuotaService(store as unknown as QuotaStore, config);
}

const HOY = new Date('2026-09-28T15:00:00Z');

describe('EmailQuotaService', () => {
  it('cuenta por empresa y día UTC, y el contador expira solo', async () => {
    const store = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const quota = build(store);

    await expect(quota.consume('c1', HOY)).resolves.toEqual({
      allowed: true,
      used: 1,
      limit: 3,
    });
    expect(store.incr).toHaveBeenCalledWith('email-quota:c1:2026-09-28');
    expect(store.expire).toHaveBeenCalledWith(
      'email-quota:c1:2026-09-28',
      2 * 24 * 60 * 60,
    );
  });

  it('pasado el tope, no deja enviar', async () => {
    const store = {
      incr: jest.fn().mockResolvedValue(4),
      expire: jest.fn(),
    };

    const out = await build(store).consume('c1', HOY);

    expect(out.allowed).toBe(false);
    // El vencimiento se fija solo con el primer envío del día.
    expect(store.expire).not.toHaveBeenCalled();
  });

  it('si Redis no responde, deja pasar: un problema de Redis no corta el correo', async () => {
    const store = {
      incr: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      expire: jest.fn(),
    };

    await expect(build(store).consume('c1', HOY)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('informa cuántos lleva hoy (0 si no hay dato)', async () => {
    const quota = build({
      get: jest.fn().mockResolvedValueOnce('7').mockResolvedValueOnce(null),
    });

    await expect(quota.used('c1', HOY)).resolves.toBe(7);
    await expect(quota.used('c1', HOY)).resolves.toBe(0);
  });
});
