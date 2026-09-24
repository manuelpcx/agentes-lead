import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { CompanyAuthGuard } from './company-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { TenantContext } from './tenant-context';

const COMPANY_ID = '3f1b2a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const SECRET = 'secreto-de-webhook';
const BODY = Buffer.from(JSON.stringify({ externalId: 'lead-1' }));

function buildGuard(
  requireTimestamp = false,
  company: unknown = { id: COMPANY_ID, name: 'Demo', webhookSecret: 'enc' },
) {
  const prisma = {
    raw: { company: { findFirst: jest.fn().mockResolvedValue(company) } },
  } as unknown as PrismaService;
  const crypto = {
    decrypt: jest.fn().mockReturnValue(SECRET),
    safeEquals: (a: string, b: string) => a === b,
  } as unknown as CryptoService;
  const config = {
    get: jest.fn().mockReturnValue(requireTimestamp),
  } as unknown as ConfigService<never, true>;
  return new CompanyAuthGuard(prisma, crypto, config);
}

function contextWith(headers: Record<string, string>, rawBody: Buffer = BODY) {
  const req = { headers, rawBody } as Record<string, unknown>;
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

const signV1 = (body: Buffer) =>
  createHmac('sha256', SECRET).update(body).digest('hex');
const signV2 = (body: Buffer, ts: number) =>
  createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');

/** Corre el guard dentro de un contexto de tenant, como en producción. */
function run<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: '', correlationId: 'c1' }, fn);
}

describe('CompanyAuthGuard — esquema v2 (con X-Timestamp)', () => {
  it('acepta una firma sobre "<timestamp>.<cuerpo>" reciente y fija el tenant', async () => {
    const guard = buildGuard();
    const ts = Date.now();
    const { req, context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-timestamp': String(ts),
      'x-signature': signV2(BODY, ts),
    });

    const visto = await TenantContext.run(
      { companyId: '', correlationId: 'c1' },
      async () => {
        await guard.canActivate(context);
        return TenantContext.getCompanyId();
      },
    );
    expect(visto).toBe(COMPANY_ID);
    expect(req.company).toEqual({ id: COMPANY_ID, name: 'Demo' });
  });

  it('rechaza un timestamp de hace 10 minutos aunque la firma sea correcta (replay)', async () => {
    const guard = buildGuard();
    const ts = Date.now() - 10 * 60 * 1000;
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-timestamp': String(ts),
      'x-signature': signV2(BODY, ts),
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      /ventana de 5 minutos/,
    );
  });

  it('rechaza si el timestamp firmado no es el enviado', async () => {
    const guard = buildGuard();
    const ts = Date.now();
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-timestamp': String(ts + 1),
      'x-signature': signV2(BODY, ts),
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza una firma v1 (solo cuerpo) cuando viene X-Timestamp', async () => {
    const guard = buildGuard();
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-timestamp': String(Date.now()),
      'x-signature': signV1(BODY),
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('CompanyAuthGuard — esquema v1 (sin timestamp)', () => {
  it('se acepta mientras WEBHOOK_REQUIRE_TIMESTAMP sea false', async () => {
    const guard = buildGuard(false);
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-signature': signV1(BODY),
    });
    await expect(run(() => guard.canActivate(context))).resolves.toBe(true);
  });

  it('se rechaza cuando WEBHOOK_REQUIRE_TIMESTAMP es true, pidiendo el header', async () => {
    const guard = buildGuard(true);
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-signature': signV1(BODY),
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      /X-Timestamp/,
    );
  });

  it('rechaza una firma v1 incorrecta', async () => {
    const guard = buildGuard(false);
    const { context } = contextWith({
      'x-company-id': COMPANY_ID,
      'x-signature': signV1(Buffer.from('otro cuerpo')),
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      'Firma HMAC inválida',
    );
  });
});

describe('CompanyAuthGuard — identificación', () => {
  it('rechaza sin headers, con un X-Company-Id que no es UUID, o empresa inexistente', async () => {
    await expect(
      run(() => buildGuard().canActivate(contextWith({}).context)),
    ).rejects.toThrow(/Faltan headers/);
    await expect(
      run(() =>
        buildGuard().canActivate(
          contextWith({ 'x-company-id': 'no-uuid', 'x-signature': 'x' })
            .context,
        ),
      ),
    ).rejects.toThrow('X-Company-Id inválido');
    await expect(
      run(() =>
        buildGuard(false, null).canActivate(
          contextWith({ 'x-company-id': COMPANY_ID, 'x-signature': 'x' })
            .context,
        ),
      ),
    ).rejects.toThrow(/no encontrada/);
  });
});
