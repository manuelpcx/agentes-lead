import { Queue } from 'bullmq';
import { CrmEventsService } from './crm-events.service';
import { CredentialsService } from '../integrations/credentials.service';
import { TenantContext } from '../common/tenant/tenant-context';

function build(cred: unknown) {
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue;
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  return { svc: new CrmEventsService(queue, credentials), queue };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

describe('CrmEventsService.emit', () => {
  it('no encola nada si no hay integración de CRM configurada', async () => {
    const { svc, queue } = build(null);
    await run(() =>
      svc.emit({
        leadId: 'lead-1',
        event: 'lead.status_changed',
        data: { from: 'NUEVO', to: 'AGENDADO' },
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('no encola si está inactiva, sin secreto, o sin URL', async () => {
    const { svc, queue } = build({
      isActive: false,
      secret: 'k',
      config: { url: 'https://x.cl' },
    });
    await run(() => svc.emit({ leadId: 'l1', event: 'test.ping', data: {} }));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('encola el evento con companyId/leadId/externalId cuando está configurado', async () => {
    const { svc, queue } = build({
      isActive: true,
      secret: 'wh-secret',
      config: { url: 'https://n8n.cliente.cl/webhook/abc' },
    });
    await run(() =>
      svc.emit({
        leadId: 'lead-1',
        externalId: 'ext-1',
        event: 'lead.promise_to_pay',
        data: { fecha: '2026-09-10' },
      }),
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data] = (queue.add as jest.Mock).mock.calls[0];
    expect(name).toBe('deliver');
    expect(data).toMatchObject({
      companyId: 'c1',
      leadId: 'lead-1',
      externalId: 'ext-1',
      event: 'lead.promise_to_pay',
      data: { fecha: '2026-09-10' },
    });
    expect(typeof data.occurredAt).toBe('string');
  });
});
