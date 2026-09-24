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

function build(cred: unknown) {
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  return new IntegrationTester(credentials);
}

function mockFetch(status: number) {
  const fn = jest
    .fn()
    .mockResolvedValue({ ok: status >= 200 && status < 300, status });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
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
