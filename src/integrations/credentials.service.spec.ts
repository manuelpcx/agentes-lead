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
  const prisma = { db: { integration } } as unknown as PrismaService;
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

  it('status NO expone el secreto', async () => {
    const { svc } = build({
      channel: 'whatsapp',
      provider: 'ycloud',
      config: { from: '+56' },
      secretEnc: 'enc(x)',
      isActive: true,
    });
    const list = await run(() => svc.status());
    expect(list[0].configured).toBe(true);
    expect(JSON.stringify(list[0])).not.toContain('secret');
    expect(JSON.stringify(list[0])).not.toContain('enc(');
  });
});
