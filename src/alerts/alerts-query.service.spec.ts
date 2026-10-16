import { PrismaService } from '../common/prisma/prisma.service';
import { AlertsQueryService } from './alerts-query.service';

const NOW = new Date('2026-10-08T12:00:00Z');
const BASE = {
  hint: null,
  kind: 'account',
  failureCount: 2,
  openedAt: NOW,
  resolvedAt: null,
  affectedCompanyIds: ['c1'],
};
const PROPIO = {
  ...BASE,
  id: 'p1',
  scope: 'company',
  companyId: 'c1',
  service: 'whatsapp',
  provider: 'ycloud',
  reason: 'Sin saldo.',
};
const DE_PLATAFORMA = {
  ...BASE,
  id: 'x1',
  scope: 'platform',
  companyId: null,
  service: 'voice',
  provider: 'elevenlabs',
  reason: 'Twilio suspendido.',
};

function build(admin: boolean) {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce([PROPIO])
    .mockResolvedValueOnce([DE_PLATAFORMA]);
  const prisma = {
    raw: {
      providerIncident: { findMany },
      user: {
        findUnique: jest.fn().mockResolvedValue({ isPlatformAdmin: admin }),
      },
    },
  } as unknown as PrismaService;
  return { service: new AlertsQueryService(prisma), findMany };
}

describe('AlertsQueryService.forCompany', () => {
  it('usuario normal: los propios con detalle; los de plataforma que lo afectan, sin detalle', async () => {
    const h = build(false);
    const r = await h.service.forCompany('c1', 'u1');

    expect(h.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'c1',
      scope: 'company',
      resolvedAt: null,
    });
    expect(h.findMany.mock.calls[1][0].where).toEqual({
      scope: 'platform',
      resolvedAt: null,
      affectedCompanyIds: { has: 'c1' },
    });
    expect(r.own).toEqual([
      expect.objectContaining({
        id: 'p1',
        providerLabel: 'YCloud',
        reason: 'Sin saldo.',
      }),
    ]);
    expect(r.platform).toEqual([{ id: 'x1', service: 'voice', openedAt: NOW }]);
  });

  it('administrador de la plataforma: todos los de plataforma, con detalle', async () => {
    const h = build(true);
    const r = await h.service.forCompany('c1', 'admin');
    expect(h.findMany.mock.calls[1][0].where).toEqual({
      scope: 'platform',
      resolvedAt: null,
    });
    expect(r.platform[0]).toMatchObject({
      providerLabel: 'ElevenLabs',
      reason: 'Twilio suspendido.',
    });
  });
});

describe('AlertsQueryService.listForPlatform', () => {
  it('abiertos y cerrados en los últimos 7 días, con empresa y empresas afectadas', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...PROPIO, company: { name: 'Sur' } },
      { ...DE_PLATAFORMA, company: null, affectedCompanyIds: ['c1', 'c2'] },
    ]);
    const prisma = {
      raw: { providerIncident: { findMany } },
    } as unknown as PrismaService;
    const rows = await new AlertsQueryService(prisma).listForPlatform(NOW);

    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { resolvedAt: null },
        { resolvedAt: { gte: new Date(NOW.getTime() - 7 * 86_400_000) } },
      ],
    });
    expect(rows[0]).toMatchObject({ companyName: 'Sur', affectedCompanies: 1 });
    expect(rows[1]).toMatchObject({ companyName: null, affectedCompanies: 2 });
  });
});
