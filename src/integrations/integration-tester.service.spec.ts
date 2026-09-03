import { IntegrationTester } from './integration-tester.service';
import { CredentialsService } from './credentials.service';

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
});
