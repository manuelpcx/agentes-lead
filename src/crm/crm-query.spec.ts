import { queryCrm } from './crm-query';
import { signHmacSha256Hex } from '../common/webhook-signature';

const REQ = {
  companyId: 'c1',
  leadId: 'lead-1',
  externalId: 'ext-1',
  query: '¿Cuál es el saldo actual del cliente?',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(impl: (init: any) => Promise<unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = jest.fn(async (_url: string, init: any) => impl(init));
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe('queryCrm', () => {
  it('firma el request y devuelve data cuando la respuesta trae {data: "..."}', async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: 'Saldo: $50.000' }),
    }));

    const result = await queryCrm(
      'https://n8n.cliente.cl/query',
      'wh-secret',
      REQ,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBe('Saldo: $50.000');
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      event: 'crm.query',
      companyId: 'c1',
      leadId: 'lead-1',
      externalId: 'ext-1',
      query: REQ.query,
    });
    expect(init.headers['X-Signature']).toBe(
      signHmacSha256Hex('wh-secret', init.body),
    );
  });

  it('si la respuesta es JSON sin campo data, la serializa entera', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ saldo: 50000, moneda: 'CLP' }),
    }));
    const result = await queryCrm('https://x.cl', 'secret', REQ);
    expect(result.ok).toBe(true);
    expect(result.data).toBe('{"saldo":50000,"moneda":"CLP"}');
  });

  it('si la respuesta no es JSON, usa el texto tal cual', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => 'Saldo: $50.000 (texto plano)',
    }));
    const result = await queryCrm('https://x.cl', 'secret', REQ);
    expect(result.data).toBe('Saldo: $50.000 (texto plano)');
  });

  it('recorta respuestas muy largas', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: 'x'.repeat(5000) }),
    }));
    const result = await queryCrm('https://x.cl', 'secret', REQ);
    expect(result.data?.length).toBe(4000);
  });

  it('devuelve ok:false si el CRM responde con error', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }));
    const result = await queryCrm('https://x.cl', 'secret', REQ);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('500');
  });

  it('devuelve ok:false si se agota el timeout', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const result = await queryCrm('https://x.cl', 'secret', REQ, 10);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no respondió/i);
  });

  it('devuelve ok:false si la conexión falla', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('DNS falló'));
    const result = await queryCrm('https://x.cl', 'secret', REQ);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('DNS falló');
  });
});
