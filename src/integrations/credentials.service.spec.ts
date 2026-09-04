import { CredentialsService } from './credentials.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TenantContext } from '../common/tenant/tenant-context';

function build(existing: unknown) {
  const integration = {
    findFirst: jest.fn().mockResolvedValue(existing),
    findMany: jest.fn().mockResolvedValue(existing ? [existing] : []),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  // `get`/`getByCompanyId` leen de `raw` (companyId explícito, sin
  // TenantContext); `upsert`/`status` siguen usando `db` (tenant-scoped).
  const prisma = {
    db: { integration },
    raw: { integration },
  } as unknown as PrismaService;
  const crypto = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
  } as unknown as CryptoService;
  return { svc: new CredentialsService(prisma, crypto), integration, crypto };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

describe('CredentialsService', () => {
  it('al guardar por primera vez, cifra el secreto', async () => {
    const { svc, integration, crypto } = build(null);
    await run(() =>
      svc.upsert('whatsapp', {
        provider: 'ycloud',
        config: { from: '+569', wabaId: 'w1' },
        secret: 'api-key-123',
      }),
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('api-key-123');
    const data = (integration.create as jest.Mock).mock.calls[0][0].data;
    expect(data.secretEnc).toBe('enc(api-key-123)');
    expect(data.companyId).toBe('c1');
    expect(data.channel).toBe('whatsapp');
  });

  it('al actualizar sin secreto, no lo pisa', async () => {
    const { svc, integration, crypto } = build({ id: 'i1' });
    await run(() =>
      svc.upsert('whatsapp', { provider: 'ycloud', config: { from: '+56' } }),
    );
    expect(crypto.encrypt).not.toHaveBeenCalled();
    const data = (integration.update as jest.Mock).mock.calls[0][0].data;
    expect(data.secretEnc).toBeUndefined();
  });

  it('get descifra el secreto', async () => {
    const { svc } = build({
      provider: 'ycloud',
      config: { from: '+56' },
      secretEnc: 'enc(secreto)',
      isActive: true,
    });
    const c = await run(() => svc.get('whatsapp'));
    expect(c?.secret).toBe('secreto');
    expect(c?.provider).toBe('ycloud');
  });

  it('get/getByCompanyId también descifran el secreto de firma de webhook', async () => {
    const { svc, integration } = build({
      provider: 'ycloud',
      config: {},
      secretEnc: 'enc(api-key)',
      webhookSecretEnc: 'enc(wh-secret)',
      isActive: true,
    });
    const c = await svc.getByCompanyId('c1', 'whatsapp');
    expect(c?.secret).toBe('api-key');
    expect(c?.webhookSecret).toBe('wh-secret');
    expect(integration.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'c1', channel: 'whatsapp' },
    });
  });

  it('getByCompanyId sin webhookSecretEnc guardado: webhookSecret queda undefined', async () => {
    const { svc } = build({
      provider: 'retell',
      config: {},
      secretEnc: 'enc(api-key)',
      webhookSecretEnc: null,
      isActive: true,
    });
    const c = await svc.getByCompanyId('c1', 'voice');
    expect(c?.webhookSecret).toBeUndefined();
  });

  it('upsert cifra el webhookSecret cuando viene', async () => {
    const { svc, integration, crypto } = build(null);
    await run(() =>
      svc.upsert('whatsapp', {
        provider: 'ycloud',
        secret: 'api-key',
        webhookSecret: 'wh-secret',
      }),
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('wh-secret');
    const data = (integration.create as jest.Mock).mock.calls[0][0].data;
    expect(data.webhookSecretEnc).toBe('enc(wh-secret)');
  });

  it('upsert sin webhookSecret al actualizar: no lo pisa', async () => {
    const { svc, integration } = build({ id: 'i1' });
    await run(() =>
      svc.upsert('whatsapp', { provider: 'ycloud', secret: 'k' }),
    );
    const data = (integration.update as jest.Mock).mock.calls[0][0].data;
    expect(data.webhookSecretEnc).toBeUndefined();
  });

  it('status NO expone los secretos, solo si están configurados', async () => {
    const { svc } = build({
      channel: 'whatsapp',
      provider: 'ycloud',
      config: { from: '+56' },
      secretEnc: 'enc(x)',
      webhookSecretEnc: 'enc(y)',
      isActive: true,
    });
    const list = await run(() => svc.status());
    expect(list[0].configured).toBe(true);
    expect(list[0].webhookSecretConfigured).toBe(true);
    expect(JSON.stringify(list[0])).not.toContain('enc(');
  });
});
