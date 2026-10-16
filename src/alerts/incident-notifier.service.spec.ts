import { ConfigService } from '@nestjs/config';
import type { ProviderIncident } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformEmailService } from '../email/platform-email.service';
import { IncidentNotifier } from './incident-notifier.service';

const NOW = new Date('2026-10-06T19:30:00Z');

const INC = {
  id: 'i1',
  companyId: 'c1',
  scope: 'company',
  service: 'whatsapp',
  provider: 'ycloud',
  kind: 'account',
  reason: 'La cuenta de YCloud no tiene saldo.',
  hint: 'Recarga saldo en YCloud.',
  failureCount: 1,
  affectedCompanyIds: ['c1'],
  openedAt: NOW,
  lastFailureAt: NOW,
  resolvedAt: null,
  openNotifiedAt: null,
  key: 'company:c1:whatsapp:ycloud',
  openKey: 'company:c1:whatsapp:ycloud',
} as ProviderIncident;

function build(
  opts: {
    owners?: string[];
    admins?: string[];
    recent?: boolean;
    env?: Record<string, string>;
  } = {},
) {
  const prisma = {
    raw: {
      providerIncident: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.recent ? { id: 'viejo' } : null),
        update: jest.fn().mockResolvedValue({}),
      },
      membership: {
        findMany: jest.fn().mockResolvedValue(
          (opts.owners ?? ['duena@sur.cl']).map((email) => ({
            user: { email },
          })),
        ),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(
          (opts.admins ?? ['admin@plataforma.cl']).map((email) => ({
            email,
          })),
        ),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Cobranzas del Sur' }),
      },
    },
  };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const env = opts.env ?? { PANEL_URL: 'https://panel.x' };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService<
    EnvVars,
    true
  >;
  const notifier = new IncidentNotifier(
    prisma as unknown as PrismaService,
    email as unknown as PlatformEmailService,
    config,
  );
  return { notifier, prisma, email };
}

describe('IncidentNotifier', () => {
  it('apertura de una cuenta de empresa: correo a los dueños con enlace a Integraciones', async () => {
    const h = build({ owners: ['duena@sur.cl', 'socio@sur.cl'] });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(true);

    expect(h.prisma.raw.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'c1', role: 'OWNER' }),
      }),
    );
    expect(h.email.send).toHaveBeenCalledTimes(2);
    expect(h.email.send.mock.calls[0][0]).toMatchObject({ to: 'duena@sur.cl' });
    expect(h.email.send.mock.calls[0][0].text).toContain(
      'https://panel.x/integrations',
    );
    expect(h.prisma.raw.providerIncident.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { openNotifiedAt: NOW },
    });
  });

  it('apertura de una cuenta de plataforma: correo a los administradores', async () => {
    const h = build();
    await h.notifier.opened(
      { ...INC, scope: 'platform', companyId: null },
      NOW,
    );
    expect(h.prisma.raw.user.findMany).toHaveBeenCalled();
    expect(h.email.send.mock.calls[0][0]).toMatchObject({
      to: 'admin@plataforma.cl',
    });
    expect(h.email.send.mock.calls[0][0].text).toContain(
      'https://panel.x/platform',
    );
  });

  it('no repite el correo si ya se avisó otro incidente igual hace menos de 6 h', async () => {
    const h = build({ recent: true });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.prisma.raw.providerIncident.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: INC.key,
          id: { not: 'i1' },
          openNotifiedAt: { gte: new Date(NOW.getTime() - 6 * 3_600_000) },
        }),
      }),
    );
    expect(h.email.send).not.toHaveBeenCalled();
  });

  it('empresa sin dueños: no hay correo ni se marca como avisado', async () => {
    const h = build({ owners: [] });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.email.send).not.toHaveBeenCalled();
    expect(h.prisma.raw.providerIncident.update).not.toHaveBeenCalled();
  });

  it('si todos los envíos del aviso fallan, no se marca como avisado', async () => {
    const h = build();
    h.email.send.mockRejectedValue(new Error('smtp caído'));
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.prisma.raw.providerIncident.update).not.toHaveBeenCalled();
  });

  it('cierre: solo si se avisó la apertura', async () => {
    const h = build();
    await h.notifier.resolved(INC, NOW);
    expect(h.email.send).not.toHaveBeenCalled();

    await h.notifier.resolved(
      { ...INC, openNotifiedAt: NOW },
      new Date(NOW.getTime() + 3_600_000),
    );
    expect(h.email.send).toHaveBeenCalledTimes(1);
    expect(h.email.send.mock.calls[0][0].subject).toContain('volvió a enviar');
  });

  it('sin PANEL_URL usa CORS_ORIGIN, igual que el correo de contraseña', async () => {
    const h = build({ env: { CORS_ORIGIN: 'https://front.x,https://otro.x' } });
    await h.notifier.opened(INC, NOW);
    expect(h.email.send.mock.calls[0][0].text).toContain(
      'https://front.x/integrations',
    );
  });
});
