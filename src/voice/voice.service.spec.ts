import { ConfigService } from '@nestjs/config';
import { AgentType } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { VoiceService } from './voice.service';
import { VoiceUsageCheck, VoiceUsageService } from './voice-usage.service';
import { resetElevenLabsCache } from './providers/elevenlabs.provider';

const PLATAFORMA: Record<string, string> = {
  ELEVENLABS_API_KEY: 'xi_plataforma',
  ELEVENLABS_PHONE_NUMBER_ID: 'phnum_plataforma',
  ELEVENLABS_AGENT_ID_DEFAULT: 'agent_general',
  ELEVENLABS_AGENT_ID_COBRANZA: 'agent_cobranza',
  ELEVENLABS_WEBHOOK_SECRET: 'wsec',
};

function build(opts: {
  env?: Record<string, string>;
  byo?: unknown;
  check?: Partial<VoiceUsageCheck>;
}) {
  const env = opts.env ?? PLATAFORMA;
  const config = {
    get: (k: string) => env[k],
  } as unknown as ConfigService<EnvVars, true>;
  const credentials = {
    get: jest.fn().mockResolvedValue(opts.byo ?? null),
  } as unknown as CredentialsService;
  const usage = {
    check: jest.fn().mockResolvedValue({
      allowed: true,
      minutesUsed: 10,
      minutesLimit: 100,
      ...opts.check,
    }),
    recordStart: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new VoiceService(
      credentials,
      usage as unknown as VoiceUsageService,
      config,
    ),
    usage,
  };
}

function res(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(...responses: ReturnType<typeof res>[]): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

const PARAMS = {
  to: '+56911111111',
  metadata: { companyId: 'c1', leadId: 'lead-1' },
  dynamicVariables: { nombre: 'Ana' },
};

describe('VoiceService — voz gestionada', () => {
  beforeEach(() => resetElevenLabsCache());

  it('llama con el agente de cobranza de la plataforma y registra la llamada', async () => {
    const fetchMock = mockFetch(
      res(200, { provider: 'twilio' }),
      res(200, { success: true, conversation_id: 'conv_1' }),
    );
    const h = build({});

    await expect(
      run(() =>
        h.service.startCall({ ...PARAMS, agentType: AgentType.COBRANZA }),
      ),
    ).resolves.toEqual({ callId: 'conv_1' });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({
      agent_id: 'agent_cobranza',
      agent_phone_number_id: 'phnum_plataforma',
    });
    expect(fetchMock.mock.calls[1][1].headers['xi-api-key']).toBe(
      'xi_plataforma',
    );
    expect(h.usage.recordStart).toHaveBeenCalledWith({
      companyId: 'c1',
      leadId: 'lead-1',
      provider: 'elevenlabs',
      managed: true,
      callId: 'conv_1',
    });
  });

  it('los demás tipos usan el agente por defecto', async () => {
    const fetchMock = mockFetch(
      res(200, { provider: 'twilio' }),
      res(200, { success: true, conversation_id: 'conv_2' }),
    );
    const h = build({});

    await run(() =>
      h.service.startCall({ ...PARAMS, agentType: AgentType.VENTAS }),
    );

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).agent_id).toBe(
      'agent_general',
    );
  });

  it('sin minutos no llama y le dice al agente que siga por texto', async () => {
    const fetchMock = mockFetch();
    const h = build({
      check: {
        allowed: false,
        reason: 'Se acabaron los minutos de llamadas de este mes (100 de 100).',
      },
    });

    await expect(run(() => h.service.startCall(PARAMS))).rejects.toThrow(
      /Se acabaron los minutos.*Sigue por WhatsApp o correo/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.usage.recordStart).not.toHaveBeenCalled();
  });

  it('informa su disponibilidad con los minutos del mes', async () => {
    const h = build({});

    await expect(run(() => h.service.availability())).resolves.toEqual({
      mode: 'managed',
      canCall: true,
      reason: undefined,
      minutesUsed: 10,
      minutesLimit: 100,
    });
  });
});

describe('VoiceService — cuenta propia y sin voz', () => {
  it('si la empresa conectó su cuenta, llama por ella y sin tope', async () => {
    const fetchMock = mockFetch(res(200, { call_id: 'call_retell' }));
    const h = build({
      byo: {
        provider: 'retell',
        secret: 'key_propia',
        config: { fromNumber: '+56922222222' },
        isActive: true,
      },
    });

    await run(() => h.service.startCall(PARAMS));

    expect(fetchMock.mock.calls[0][0]).toContain('retellai.com');
    expect(h.usage.check).not.toHaveBeenCalled();
    expect(h.usage.recordStart).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'retell', managed: false }),
    );
    await expect(run(() => h.service.availability())).resolves.toEqual({
      mode: 'byo',
      canCall: true,
    });
  });

  it('sin voz gestionada ni cuenta propia no puede llamar', async () => {
    const h = build({ env: {} });

    await expect(run(() => h.service.availability())).resolves.toMatchObject({
      mode: 'none',
      canCall: false,
    });
    expect(h.service.managedAvailable).toBe(false);
  });
});
