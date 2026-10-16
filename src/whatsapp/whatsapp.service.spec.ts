import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { WhatsappService } from './whatsapp.service';

function build(cred: unknown) {
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  const health = {
    observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()),
  };
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  return {
    service: new WhatsappService(
      credentials,
      health as unknown as ProviderHealthService,
    ),
    health,
  };
}

const run = <T>(fn: () => Promise<T>) =>
  TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);

describe('WhatsappService y la salud del proveedor', () => {
  it('con YCloud: el envío pasa por observe como cuenta de la empresa', async () => {
    const h = build({
      provider: 'ycloud',
      isActive: true,
      secret: 'k',
      config: { from: '+56900000000' },
    });
    await run(() => h.service.send('+56911111111', 'hola'));
    expect(h.health.observe).toHaveBeenCalledWith(
      {
        service: 'whatsapp',
        provider: 'ycloud',
        scope: 'company',
        companyId: 'c1',
      },
      expect.any(Function),
    );
  });

  it('plantilla con Meta: también', async () => {
    const h = build({
      provider: 'meta',
      isActive: true,
      secret: 'k',
      config: { phoneNumberId: '123' },
    });
    await run(() =>
      h.service.sendTemplate('+56911111111', {
        name: 'apertura',
        languageCode: 'es',
        bodyParams: [],
      }),
    );
    expect(h.health.observe).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta' }),
      expect.any(Function),
    );
  });

  it('sin WhatsApp configurado (log): no se registra nada', async () => {
    const h = build(null);
    await run(() => h.service.send('+56911111111', 'hola'));
    expect(h.health.observe).not.toHaveBeenCalled();
  });
});
