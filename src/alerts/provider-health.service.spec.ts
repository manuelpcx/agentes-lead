import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { IncidentNotifier } from './incident-notifier.service';
import { ProviderError } from './provider-error';
import { ProviderHealthService } from './provider-health.service';
import type { HealthTarget } from './alerts.types';

const NOW = new Date('2026-10-06T19:30:00Z');
const WA: HealthTarget = {
  service: 'whatsapp',
  provider: 'ycloud',
  scope: 'company',
  companyId: 'c1',
};
const SIN_SALDO = new ProviderError(
  'Fallo (YCloud 403)',
  403,
  'BALANCE_INSUFFICIENT',
);
const CAIDO = new ProviderError('Fallo (YCloud 503)', 503);
const TELEFONO_MALO = new ProviderError(
  'Fallo (YCloud 400: Invalid phone)',
  400,
);

function build(
  opts: { open?: object | null; streak?: number[]; redisDown?: boolean } = {},
) {
  const incident = {
    findUnique: jest.fn().mockResolvedValue(opts.open ?? null),
    create: jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'nuevo', ...data }),
      ),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    raw: { providerIncident: incident },
  } as unknown as PrismaService;
  const incr = jest.fn();
  (opts.streak ?? [1]).forEach((n) => incr.mockResolvedValueOnce(n));
  if (opts.redisDown) incr.mockRejectedValue(new Error('redis caído'));
  const store = {
    incr,
    expire: jest.fn().mockResolvedValue(1),
    del: opts.redisDown
      ? jest.fn().mockRejectedValue(new Error('redis caído'))
      : jest.fn().mockResolvedValue(1),
  };
  const notifier = {
    opened: jest.fn().mockResolvedValue(true),
    resolved: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProviderHealthService(
    prisma,
    store,
    notifier as unknown as IncidentNotifier,
  );
  return { service, incident, store, notifier };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('ProviderHealthService — fallos', () => {
  it('error de cuenta: abre el incidente al primer fallo y avisa', async () => {
    const h = build();
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        scope: 'company',
        service: 'whatsapp',
        provider: 'ycloud',
        kind: 'account',
        reason: 'La cuenta de YCloud no tiene saldo.',
        hint: 'Recarga saldo en YCloud.',
        failureCount: 1,
        affectedCompanyIds: ['c1'],
        key: 'company:c1:whatsapp:ycloud',
        openKey: 'company:c1:whatsapp:ycloud',
        openedAt: NOW,
      }),
    });
    expect(h.notifier.opened).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nuevo' }),
      NOW,
    );
  });

  it('error del mensaje: no abre nada, ni cuenta para la racha', async () => {
    const h = build();
    await h.service.failure(WA, TELEFONO_MALO, NOW);
    expect(h.incident.findUnique).not.toHaveBeenCalled();
    expect(h.store.incr).not.toHaveBeenCalled();
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('muchos errores del mensaje seguidos (importación con teléfonos malos) no abren nada', async () => {
    const h = build();
    for (let i = 0; i < 25; i++)
      await h.service.failure(WA, TELEFONO_MALO, NOW);
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('pasajero: abre recién al tercer fallo seguido, con esos 3 fallos', async () => {
    const h = build({ streak: [1, 2, 3] });
    await h.service.failure(WA, CAIDO, NOW);
    await h.service.failure(WA, CAIDO, NOW);
    expect(h.incident.create).not.toHaveBeenCalled();
    await h.service.failure(WA, CAIDO, NOW);
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'transient', failureCount: 3 }),
    });
    // La ventana corre desde el primer fallo de la racha.
    expect(h.store.expire).toHaveBeenCalledTimes(1);
    expect(h.store.expire).toHaveBeenCalledWith(
      'provider-health:streak:company:c1:whatsapp:ycloud',
      900,
    );
  });

  it('pasajero sin Redis: no abre y no rompe', async () => {
    const h = build({ redisDown: true });
    await expect(h.service.failure(WA, CAIDO, NOW)).resolves.toBeUndefined();
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('error de cuenta sin Redis: abre igual (no depende de Redis)', async () => {
    const h = build({ redisDown: true });
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.create).toHaveBeenCalled();
  });

  it('con un incidente ya abierto: suma el fallo, agrega la empresa y no avisa de nuevo', async () => {
    const h = build({ open: { id: 'abierto', affectedCompanyIds: ['c9'] } });
    await h.service.failure(
      {
        service: 'voice',
        provider: 'elevenlabs',
        scope: 'platform',
        companyId: 'c1',
      },
      SIN_SALDO,
      NOW,
    );
    expect(h.incident.create).not.toHaveBeenCalled();
    expect(h.incident.update).toHaveBeenCalledWith({
      where: { id: 'abierto' },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: NOW,
        affectedCompanyIds: ['c9', 'c1'],
      },
    });
    expect(h.notifier.opened).not.toHaveBeenCalled();
  });

  it('carrera: si otro proceso lo abrió primero (P2002), suma el fallo y no avisa', async () => {
    const h = build();
    h.incident.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    h.incident.findUnique
      .mockResolvedValueOnce(null) // antes de crear: no había
      .mockResolvedValueOnce({ id: 'del-otro', affectedCompanyIds: ['c1'] });
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'del-otro' } }),
    );
    expect(h.notifier.opened).not.toHaveBeenCalled();
  });

  it('plataforma sin empresa en contexto (proceso nocturno): abre sin empresas afectadas', async () => {
    const h = build();
    await h.service.failure(
      { service: 'llm', provider: 'anthropic', scope: 'platform' },
      Object.assign(new Error('Your credit balance is too low'), {
        status: 400,
      }),
      NOW,
    );
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: null,
        affectedCompanyIds: [],
        key: 'platform:llm:anthropic',
      }),
    });
  });
});

describe('ProviderHealthService — éxitos', () => {
  it('cierra el incidente abierto, borra la racha y avisa el cierre', async () => {
    const abierto = {
      id: 'abierto',
      openNotifiedAt: NOW,
      openedAt: NOW,
      failureCount: 3,
    };
    const h = build({ open: abierto });
    await h.service.success(WA, NOW);
    expect(h.store.del).toHaveBeenCalledWith(
      'provider-health:streak:company:c1:whatsapp:ycloud',
    );
    expect(h.incident.updateMany).toHaveBeenCalledWith({
      where: { id: 'abierto', resolvedAt: null },
      data: { resolvedAt: NOW, openKey: null },
    });
    expect(h.notifier.resolved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abierto', resolvedAt: NOW }),
      NOW,
    );
  });

  it('sin incidente abierto: no escribe nada', async () => {
    const h = build();
    await h.service.success(WA, NOW);
    expect(h.incident.updateMany).not.toHaveBeenCalled();
    expect(h.notifier.resolved).not.toHaveBeenCalled();
  });

  it('si otro proceso ya lo cerró, no repite el aviso', async () => {
    const h = build({ open: { id: 'abierto', openNotifiedAt: NOW } });
    h.incident.updateMany.mockResolvedValueOnce({ count: 0 });
    await h.service.success(WA, NOW);
    expect(h.notifier.resolved).not.toHaveBeenCalled();
  });

  it('sin Redis: igual cierra el incidente', async () => {
    const h = build({ open: { id: 'abierto' }, redisDown: true });
    await h.service.success(WA, NOW);
    expect(h.incident.updateMany).toHaveBeenCalled();
  });
});

describe('ProviderHealthService.observe', () => {
  it('devuelve el resultado del envío y anota el éxito', async () => {
    const h = build();
    const spy = jest.spyOn(h.service, 'success');
    await expect(h.service.observe(WA, async () => 'ok')).resolves.toBe('ok');
    await flush();
    expect(spy).toHaveBeenCalledWith(WA);
  });

  it('relanza el mismo error del envío y anota el fallo', async () => {
    const h = build();
    const spy = jest.spyOn(h.service, 'failure');
    await expect(
      h.service.observe(WA, () => Promise.reject(SIN_SALDO)),
    ).rejects.toBe(SIN_SALDO);
    await flush();
    expect(spy).toHaveBeenCalledWith(WA, SIN_SALDO);
  });

  it('si anotar falla, el envío no se entera', async () => {
    const h = build();
    jest.spyOn(h.service, 'success').mockRejectedValue(new Error('db caída'));
    await expect(h.service.observe(WA, async () => 'ok')).resolves.toBe('ok');
    await flush();
  });
});
