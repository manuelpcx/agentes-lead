// Sin red en los tests: todo host "resuelve" a una IP pública, para que la
// validación anti-SSRF de las URLs del CRM deje pasar las de ejemplo.
jest.mock('node:dns/promises', () => ({
  lookup: jest
    .fn()
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { IntegrationTester } from './integration-tester.service';
import { CredentialsService } from './credentials.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { PrismaService } from '../common/prisma/prisma.service';

function build(cred: unknown, channelsConfig: unknown = {}) {
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  const prisma = {
    raw: {
      company: {
        findUnique: jest.fn().mockResolvedValue({ channelsConfig }),
      },
    },
  } as unknown as PrismaService;
  return new IntegrationTester(credentials, prisma);
}

function mockFetch(status: number) {
  const fn = jest
    .fn()
    .mockResolvedValue({ ok: status >= 200 && status < 300, status });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'company-1', correlationId: 'c1' }, fn);
}

describe('IntegrationTester', () => {
  it('sin credenciales → no ok', async () => {
    const t = build(null);
    const r = await t.test('whatsapp');
    expect(r.ok).toBe(false);
  });

  it('YCloud responde 200 → ok', async () => {
    const t = build({
      provider: 'ycloud',
      secret: 'k',
      config: { wabaId: 'w' },
    });
    mockFetch(200);
    const r = await t.test('whatsapp');
    expect(r.ok).toBe(true);
  });

  it('YCloud 401 → key inválida', async () => {
    const t = build({ provider: 'ycloud', secret: 'bad', config: {} });
    mockFetch(401);
    const r = await t.test('whatsapp');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/inválida/i);
  });

  it('Retell 200 → ok', async () => {
    const t = build({ provider: 'retell', secret: 'k', config: {} });
    mockFetch(200);
    const r = await t.test('voice');
    expect(r.ok).toBe(true);
  });

  it('ElevenLabs: valida agente y número (Twilio o SIP)', async () => {
    const t = build({
      provider: 'elevenlabs',
      secret: 'xi',
      config: { agentId: 'agent_1', phoneNumberId: 'phnum_1' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ provider: 'sip_trunk' }),
      });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const r = await run(() => t.test('voice'));

    expect(r).toEqual({
      ok: true,
      message: 'Conexión con ElevenLabs correcta.',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.elevenlabs.io/v1/convai/agents/agent_1',
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'xi-api-key': 'xi' });
  });

  it('ElevenLabs: avisa si el agente no permite el saludo configurado', async () => {
    // Lo que pasaba: la llamada salía con el saludo de Configuración y
    // ElevenLabs cortaba la conversación ("Override for field 'first_message'
    // is not allowed by config").
    const t = build(
      {
        provider: 'elevenlabs',
        secret: 'xi',
        config: { agentId: 'agent_1', phoneNumberId: 'phnum_1' },
      },
      { voice: { beginMessage: 'Hola {{nombre}}' } },
    );
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          platform_settings: {
            overrides: { conversation_config_override: { agent: {} } },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ provider: 'twilio' }),
      });

    const r = await run(() => t.test('voice'));

    expect(r.ok).toBe(true);
    expect(r.message).toContain('no permite cambiar saludo');
    expect(r.message).toContain('Security');
  });

  it('ElevenLabs: agente inexistente → lo dice', async () => {
    const t = build({
      provider: 'elevenlabs',
      secret: 'xi',
      config: { agentId: 'agent_x', phoneNumberId: 'phnum_1' },
    });
    mockFetch(404);
    const r = await t.test('voice');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('agent_x');
  });

  it('ElevenLabs: sin Agent ID o Phone Number ID → no ok sin llamar a la API', async () => {
    const t = build({ provider: 'elevenlabs', secret: 'xi', config: {} });
    const fetchMock = mockFetch(200);
    const r = await t.test('voice');
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un error de red → no ok', async () => {
    const t = build({ provider: 'resend', secret: 'k', config: {} });
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('boom'));
    const r = await t.test('email');
    expect(r.ok).toBe(false);
  });

  it('CRM: sin URL configurada → no ok', async () => {
    const t = build({ provider: 'webhook', secret: 'wh-secret', config: {} });
    const r = await TenantContext.run(
      { companyId: 'c1', correlationId: 'x' },
      () => t.test('crm'),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/URL/);
  });

  it('CRM: manda un test.ping firmado y reporta éxito', async () => {
    const t = build({
      provider: 'webhook',
      secret: 'wh-secret',
      config: { url: 'https://n8n.cliente.cl/webhook/abc' },
    });
    const fetchMock = mockFetch(200);
    const r = await TenantContext.run(
      { companyId: 'c1', correlationId: 'x' },
      () => t.test('crm'),
    );
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://n8n.cliente.cl/webhook/abc');
    expect(init.headers['X-Signature']).toBeTruthy();
    expect(JSON.parse(init.body).event).toBe('test.ping');
  });
});
