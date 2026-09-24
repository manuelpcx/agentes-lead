import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService, ApiKeyIdentity } from './api-keys.service';
import { AuthedRequest } from '../auth/auth.types';
import { TenantContext } from '../common/tenant/tenant-context';

const IDENTITY: ApiKeyIdentity = {
  apiKeyId: 'key-1',
  companyId: 'company-1',
  role: PanelRole.OPERADOR,
  actingUserId: 'user-1',
};

function contextFor(headers: Record<string, string>) {
  const req = { headers } as unknown as AuthedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, context };
}

function buildGuard(identity: ApiKeyIdentity | null = IDENTITY) {
  const apiKeys = {
    verify: jest.fn().mockResolvedValue(identity),
  } as unknown as ApiKeysService;
  return { guard: new ApiKeyGuard(apiKeys), apiKeys };
}

/** Corre el guard dentro de un contexto de tenant, como en producción. */
function run<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: '', correlationId: 'c1' }, fn);
}

describe('ApiKeyGuard', () => {
  it('deja el request como lo dejaría el panel (user + membership)', async () => {
    const { guard } = buildGuard();
    const { req, context } = contextFor({
      authorization: 'Bearer ale_secreta',
    });

    await expect(run(() => guard.canActivate(context))).resolves.toBe(true);
    expect(req.user).toEqual({
      userId: 'user-1',
      email: 'api-key:key-1',
    });
    expect(req.membership).toEqual({
      companyId: 'company-1',
      role: PanelRole.OPERADOR,
    });
  });

  it('fija el companyId en el TenantContext (aislamiento de Prisma)', async () => {
    const { guard } = buildGuard();
    const { context } = contextFor({ 'x-api-key': 'ale_secreta' });

    const visto = await TenantContext.run(
      { companyId: '', correlationId: 'c1' },
      async () => {
        await guard.canActivate(context);
        return TenantContext.getCompanyId();
      },
    );
    expect(visto).toBe('company-1');
  });

  it('acepta la llave por X-Api-Key además de por Authorization', async () => {
    const { guard, apiKeys } = buildGuard();
    const { context } = contextFor({ 'x-api-key': 'ale_otra' });
    await run(() => guard.canActivate(context));
    expect(apiKeys.verify).toHaveBeenCalledWith('ale_otra');
  });

  it('rechaza si no viene ninguna llave', async () => {
    const { guard } = buildGuard();
    const { context } = contextFor({});
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza una llave que el servicio no valida', async () => {
    const { guard } = buildGuard(null);
    const { context } = contextFor({ authorization: 'Bearer ale_mala' });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza una llave sin usuario responsable (no hay a quién auditar)', async () => {
    const { guard } = buildGuard({ ...IDENTITY, actingUserId: null });
    const { context } = contextFor({ authorization: 'Bearer ale_huerfana' });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('ignora nunca el header: si pide otra empresa, corta', async () => {
    const { guard } = buildGuard();
    const { req, context } = contextFor({
      authorization: 'Bearer ale_secreta',
      'x-company-id': 'company-ajena',
    });
    await expect(run(() => guard.canActivate(context))).rejects.toThrow(
      ForbiddenException,
    );
    expect(req.membership).toBeUndefined();
  });

  it('acepta el header cuando coincide con la empresa de la llave', async () => {
    const { guard } = buildGuard();
    const { context } = contextFor({
      authorization: 'Bearer ale_secreta',
      'x-company-id': 'company-1',
    });
    await expect(run(() => guard.canActivate(context))).resolves.toBe(true);
  });
});
