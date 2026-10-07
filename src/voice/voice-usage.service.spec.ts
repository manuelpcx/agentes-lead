import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { VoiceUsageService, startOfMonth } from './voice-usage.service';

function build(opts: {
  limit?: number | null;
  durations?: Array<number | null>;
  enCurso?: number;
  defaultLimit?: number;
}) {
  const cfg: Record<string, unknown> = {
    VOICE_MONTHLY_MINUTES_DEFAULT: opts.defaultLimit ?? 0,
    VOICE_MAX_CONCURRENT_PER_COMPANY: 2,
  };
  const config = {
    get: (k: string) => cfg[k],
  } as unknown as ConfigService<EnvVars, true>;
  const voiceCall = {
    findMany: jest
      .fn()
      .mockResolvedValue(
        (opts.durations ?? []).map((durationSecs) => ({ durationSecs })),
      ),
    count: jest.fn().mockResolvedValue(opts.enCurso ?? 0),
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    raw: {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'America/Santiago',
          voiceMinutesLimit: opts.limit === undefined ? 100 : opts.limit,
        }),
      },
      voiceCall,
    },
  } as unknown as PrismaService;
  return { usage: new VoiceUsageService(prisma, config), voiceCall };
}

describe('VoiceUsageService.check', () => {
  it('con minutos y sin llamadas en curso, deja llamar', async () => {
    const { usage } = build({ durations: [120, 61] });

    await expect(usage.check('c1')).resolves.toEqual({
      allowed: true,
      // 120 s = 2 min; 61 s = 2 min (cada llamada se redondea hacia arriba).
      minutesUsed: 4,
      minutesLimit: 100,
    });
  });

  it('sin minutos asignados (tope 0) no hay llamadas', async () => {
    const { usage } = build({ limit: null, defaultLimit: 0 });

    const out = await usage.check('c1');

    expect(out.allowed).toBe(false);
    expect(out.reason).toContain('no están incluidas');
  });

  it('agotado el tope del mes, no deja llamar y lo dice con números', async () => {
    const { usage } = build({ limit: 3, durations: [60, 60, 60] });

    const out = await usage.check('c1');

    expect(out.allowed).toBe(false);
    expect(out.reason).toContain('3 de 3');
  });

  it('con el máximo de llamadas simultáneas en curso, espera', async () => {
    const { usage, voiceCall } = build({ enCurso: 2 });

    const out = await usage.check('c1');

    expect(out.allowed).toBe(false);
    expect(out.reason).toContain('en curso');
    // Solo cuentan las gestionadas sin fin registrado de los últimos 15 min.
    expect(voiceCall.count.mock.calls[0][0].where).toMatchObject({
      companyId: 'c1',
      managed: true,
      endedAt: null,
    });
  });
});

describe('VoiceUsageService — registro de llamadas', () => {
  it('cierra la llamada con su duración', async () => {
    const { usage, voiceCall } = build({});

    await usage.recordEnd('elevenlabs', 'conv_1', {
      status: 'completed',
      durationSecs: 94.6,
    });

    expect(voiceCall.updateMany).toHaveBeenCalledWith({
      where: { provider: 'elevenlabs', callId: 'conv_1' },
      data: expect.objectContaining({ status: 'completed', durationSecs: 95 }),
    });
  });

  it('si no se puede registrar el inicio, no rompe (la llamada ya salió)', async () => {
    const { usage, voiceCall } = build({});
    voiceCall.create.mockRejectedValueOnce(new Error('db caída'));

    await expect(
      usage.recordStart({
        companyId: 'c1',
        leadId: 'l1',
        provider: 'elevenlabs',
        managed: true,
        callId: 'conv_1',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('startOfMonth', () => {
  it('es el día 1 a medianoche en la zona de la empresa', () => {
    // 28 de sept. 2026 en Santiago → 1 de sept. 00:00 local. Ese día Chile
    // todavía está en UTC-4 (el horario de verano parte el 6): 04:00 UTC.
    expect(
      startOfMonth(
        new Date('2026-09-28T15:00:00Z'),
        'America/Santiago',
      ).toISOString(),
    ).toBe('2026-09-01T04:00:00.000Z');
  });

  it('el 1 del mes temprano en UTC todavía es el mes anterior en Chile', () => {
    // 1 de oct. 01:00 UTC = 30 de sept. 22:00 en Santiago.
    expect(
      startOfMonth(
        new Date('2026-10-01T01:00:00Z'),
        'America/Santiago',
      ).toISOString(),
    ).toBe('2026-09-01T04:00:00.000Z');
  });
});
