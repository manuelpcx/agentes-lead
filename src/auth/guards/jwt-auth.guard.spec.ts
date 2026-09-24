import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthedRequest } from '../auth.types';

const NOW_SEC = Math.floor(Date.now() / 1000);

function buildGuard(
  user: { isActive: boolean; passwordChangedAt: Date | null } | null,
  payload: { sub: string; email: string; iat?: number } | Error = {
    sub: 'user-1',
    email: 'ana@demo.cl',
    iat: NOW_SEC,
  },
) {
  const jwt = {
    verifyAsync: jest.fn(() =>
      payload instanceof Error
        ? Promise.reject(payload)
        : Promise.resolve(payload),
    ),
  } as unknown as JwtService;
  const prisma = {
    raw: { user: { findUnique: jest.fn().mockResolvedValue(user) } },
  } as unknown as PrismaService;
  return { guard: new JwtAuthGuard(jwt, prisma), prisma };
}

function contextWith(authorization?: string) {
  const req = { headers: { authorization } } as unknown as AuthedRequest;
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

const ACTIVO = { isActive: true, passwordChangedAt: null };

describe('JwtAuthGuard', () => {
  it('acepta un token válido de un usuario activo y adjunta req.user', async () => {
    const { guard } = buildGuard(ACTIVO);
    const { req, context } = contextWith('Bearer token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'user-1', email: 'ana@demo.cl' });
  });

  it('rechaza sin header o sin el prefijo Bearer', async () => {
    const { guard } = buildGuard(ACTIVO);
    await expect(guard.canActivate(contextWith().context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(contextWith('Basic abc').context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un token que no verifica (firma o expiración)', async () => {
    const { guard } = buildGuard(ACTIVO, new Error('jwt expired'));
    await expect(
      guard.canActivate(contextWith('Bearer viejo').context),
    ).rejects.toThrow('Token inválido o expirado');
  });

  it('expulsa a un usuario desactivado aunque su token siga vigente (revocación)', async () => {
    const { guard } = buildGuard({ isActive: false, passwordChangedAt: null });
    await expect(
      guard.canActivate(contextWith('Bearer token').context),
    ).rejects.toThrow(/inactivo/);
  });

  it('rechaza un token emitido ANTES del último cambio de contraseña', async () => {
    const cambio = new Date((NOW_SEC + 60) * 1000);
    const { guard } = buildGuard({ isActive: true, passwordChangedAt: cambio });
    await expect(
      guard.canActivate(contextWith('Bearer token').context),
    ).rejects.toThrow(/contraseña cambió/);
  });

  it('acepta un token emitido DESPUÉS (o en el mismo segundo) del cambio', async () => {
    const mismoSegundo = new Date(NOW_SEC * 1000 + 999);
    const { guard } = buildGuard({
      isActive: true,
      passwordChangedAt: mismoSegundo,
    });
    await expect(
      guard.canActivate(contextWith('Bearer token').context),
    ).resolves.toBe(true);
  });

  it('rechaza si el usuario del token ya no existe', async () => {
    const { guard } = buildGuard(null);
    await expect(
      guard.canActivate(contextWith('Bearer token').context),
    ).rejects.toThrow(UnauthorizedException);
  });
});
