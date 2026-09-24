import { NotFoundException } from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { ApiKeysService, hashKey } from './api-keys.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';

const COMPANY = 'company-1';
const USER = 'user-1';

interface Row {
  id: string;
  companyId: string;
  name: string;
  prefix: string;
  hash: string;
  role: PanelRole;
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function buildHarness(seed: Row[] = []) {
  const rows = [...seed];
  const apiKey = {
    create: jest.fn(({ data }: { data: Partial<Row> }) => {
      const row: Row = {
        id: `key-${rows.length + 1}`,
        companyId: data.companyId ?? COMPANY,
        name: data.name!,
        prefix: data.prefix!,
        hash: data.hash!,
        role: data.role ?? PanelRole.SOLO_LECTURA,
        createdById: data.createdById ?? null,
        lastUsedAt: null,
        expiresAt: data.expiresAt ?? null,
        revokedAt: null,
        createdAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve(row);
    }),
    findMany: jest.fn(() => Promise.resolve(rows)),
    findFirst: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
    ),
    findUnique: jest.fn(({ where }: { where: { hash: string } }) =>
      Promise.resolve(rows.find((r) => r.hash === where.hash) ?? null),
    ),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    ),
  };

  const prisma = {
    db: { apiKey },
    raw: { apiKey },
  } as unknown as PrismaService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return { service: new ApiKeysService(prisma, audit), rows, apiKey, audit };
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: COMPANY, correlationId: 'c1' }, fn);
}

describe('ApiKeysService.create', () => {
  it('devuelve la llave en claro pero guarda solo su hash', async () => {
    const { service, rows } = buildHarness();
    const created = await run(() =>
      service.create({ name: 'Claude de escritorio', createdById: USER }),
    );

    expect(created.key).toMatch(/^ale_[A-Za-z0-9_-]{20,}$/);
    expect(rows[0].hash).toBe(hashKey(created.key));
    // Lo guardado no permite reconstruir la llave.
    expect(rows[0].hash).not.toContain(created.key);
    expect(JSON.stringify(rows[0])).not.toContain(created.key.slice(10));
  });

  it('el prefijo alcanza para reconocerla pero no para usarla', async () => {
    const { service, rows } = buildHarness();
    const created = await run(() =>
      service.create({ name: 'n8n', createdById: USER }),
    );
    expect(created.prefix).toMatch(/^ale_.{6}$/);
    expect(created.key.startsWith(rows[0].prefix)).toBe(true);
    expect(created.prefix.length).toBeLessThan(created.key.length / 2);
  });

  it('por defecto la llave es de solo lectura', async () => {
    const { service } = buildHarness();
    const created = await run(() =>
      service.create({ name: 'lectura', createdById: USER }),
    );
    expect(created.role).toBe(PanelRole.SOLO_LECTURA);
  });

  it('deja en la auditoría quién la emitió', async () => {
    const { service, audit } = buildHarness();
    await run(() =>
      service.create({
        name: 'con escritura',
        role: PanelRole.OPERADOR,
        createdById: USER,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        action: 'create_api_key',
        entity: 'ApiKey',
      }),
    );
  });
});

describe('ApiKeysService.verify', () => {
  async function withKey(overrides: Partial<Row> = {}) {
    const harness = buildHarness();
    const created = await run(() =>
      harness.service.create({ name: 'k', createdById: USER }),
    );
    Object.assign(harness.rows[0], overrides);
    return { ...harness, key: created.key };
  }

  it('resuelve empresa, rol y usuario responsable', async () => {
    const { service, key } = await withKey({ role: PanelRole.OPERADOR });
    await expect(service.verify(key)).resolves.toEqual({
      apiKeyId: 'key-1',
      companyId: COMPANY,
      role: PanelRole.OPERADOR,
      actingUserId: USER,
    });
  });

  it.each([
    ['una llave desconocida', 'ale_noexiste'],
    ['algo que no tiene nuestro prefijo', 'sk-live-loquesea'],
    ['vacío', ''],
  ])('rechaza %s', async (_caso, raw) => {
    const { service } = await withKey();
    await expect(service.verify(raw)).resolves.toBeNull();
  });

  it('rechaza una llave revocada', async () => {
    const { service, key } = await withKey({ revokedAt: new Date() });
    await expect(service.verify(key)).resolves.toBeNull();
  });

  it('rechaza una llave vencida', async () => {
    const { service, key } = await withKey({
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.verify(key)).resolves.toBeNull();
  });

  it('acepta una llave con vencimiento futuro', async () => {
    const { service, key } = await withKey({
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.verify(key)).resolves.not.toBeNull();
  });

  it('anota el último uso para poder detectar llaves olvidadas', async () => {
    const { service, key, rows } = await withKey();
    await service.verify(key);
    // El update va sin await dentro del servicio: se deja correr la microtask.
    await Promise.resolve();
    expect(rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it('no falla la petición si no se puede anotar el último uso', async () => {
    const { service, key, apiKey } = await withKey();
    apiKey.update.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.verify(key)).resolves.not.toBeNull();
  });
});

describe('ApiKeysService.revoke', () => {
  it('marca la fecha sin borrar el registro', async () => {
    const { service, rows } = buildHarness();
    await run(() => service.create({ name: 'k', createdById: USER }));

    const revoked = await run(() => service.revoke('key-1', USER));
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
  });

  it('revocar dos veces conserva la fecha original', async () => {
    const { service } = buildHarness();
    await run(() => service.create({ name: 'k', createdById: USER }));
    const first = await run(() => service.revoke('key-1', USER));
    const second = await run(() => service.revoke('key-1', USER));
    expect(second.revokedAt).toEqual(first.revokedAt);
  });

  it('lanza si la llave no existe en la empresa', async () => {
    const { service } = buildHarness();
    await expect(run(() => service.revoke('key-9', USER))).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ApiKeysService.list', () => {
  it('nunca devuelve el hash ni la llave', async () => {
    const { service } = buildHarness();
    await run(() => service.create({ name: 'k', createdById: USER }));
    const [item] = await run(() => service.list());
    expect(Object.keys(item).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'id',
      'lastUsedAt',
      'name',
      'prefix',
      'revokedAt',
      'role',
    ]);
  });
});
