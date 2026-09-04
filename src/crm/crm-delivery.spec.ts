import { deliverCrmEvent } from './crm-delivery';
import { signHmacSha256Hex } from '../common/webhook-signature';
import { CrmEventJob } from './crm-event.types';

const JOB: CrmEventJob = {
  companyId: 'c1',
  leadId: 'lead-1',
  externalId: 'ext-1',
  event: 'lead.status_changed',
  data: { from: 'NUEVO', to: 'AGENDADO' },
  occurredAt: '2026-09-05T00:00:00.000Z',
};

function mockFetch(res: { ok: boolean; status: number; text?: string }) {
  const fn = jest.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    text: async () => res.text ?? '',
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe('deliverCrmEvent', () => {
  it('firma el cuerpo con el secreto y lo manda por POST', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    const result = await deliverCrmEvent(
      'https://n8n.cliente.cl/webhook/abc',
      'wh-secret',
      JOB,
    );

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://n8n.cliente.cl/webhook/abc');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      event: 'lead.status_changed',
      companyId: 'c1',
      leadId: 'lead-1',
      externalId: 'ext-1',
      occurredAt: JOB.occurredAt,
      data: { from: 'NUEVO', to: 'AGENDADO' },
    });
    expect(init.headers['X-Signature']).toBe(
      signHmacSha256Hex('wh-secret', init.body),
    );
    expect(init.headers['X-Company-Id']).toBe('c1');
  });

  it('devuelve ok:false si el CRM responde con error', async () => {
    mockFetch({ ok: false, status: 500, text: 'boom' });
    const result = await deliverCrmEvent('https://x.cl', 'secret', JOB);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.message).toContain('500');
  });

  it('devuelve ok:false si la conexión falla', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('DNS falló'));
    const result = await deliverCrmEvent('https://x.cl', 'secret', JOB);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('DNS falló');
  });
});
