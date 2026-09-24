import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthedRequest } from '../auth/auth.types';

/**
 * Este guard es la única puerta del sistema que abre el acceso a TODAS las
 * empresas. Sus tests valen más que los de cualquier ruta: un fallo acá no es
 * un bug, es una filtración entre clientes.
 */
function buildGuard(
  row: { isPlatformAdmin: boolean; isActive: boolean } | null,
) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = {
    raw: { user: { findUnique } },
  } as unknown as PrismaService;
  return { guard: new PlatformAdminGuard(prisma), findUnique };
}

function contexto(userId?: string): ExecutionContext {
  const req: AuthedRequest = {
    user: userId ? { userId, email: 'a@b.cl' } : undefined,
  } as AuthedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  it('deja pasar a un administrador de plataforma activo', async () => {
    const { guard } = buildGuard({ isPlatformAdmin: true, isActive: true });

    await expect(guard.canActivate(contexto('u-1'))).resolves.toBe(true);
  });

  it('rechaza a un usuario normal, aunque sea OWNER de su empresa', async () => {
    const { guard } = buildGuard({ isPlatformAdmin: false, isActive: true });

    await expect(guard.canActivate(contexto('u-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rechaza a un administrador desactivado', async () => {
    const { guard } = buildGuard({ isPlatformAdmin: true, isActive: false });

    await expect(guard.canActivate(contexto('u-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rechaza si el usuario ya no existe', async () => {
    const { guard } = buildGuard(null);

    await expect(guard.canActivate(contexto('u-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rechaza sin sesión', async () => {
    const { guard } = buildGuard({ isPlatformAdmin: true, isActive: true });

    await expect(guard.canActivate(contexto())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('consulta la marca en CADA petición, no la toma del token', async () => {
    const { guard, findUnique } = buildGuard({
      isPlatformAdmin: true,
      isActive: true,
    });

    await guard.canActivate(contexto('u-1'));
    await guard.canActivate(contexto('u-1'));

    // Quitarle el permiso a alguien tiene efecto de inmediato, sin esperar a
    // que caduque su sesión.
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique.mock.calls[0][0]).toMatchObject({
      where: { id: 'u-1' },
    });
  });

  it('no dice si el permiso existe: mismo mensaje en todos los rechazos', async () => {
    const normal = buildGuard({ isPlatformAdmin: false, isActive: true });
    const inexistente = buildGuard(null);

    const mensajes = await Promise.all(
      [normal, inexistente].map(({ guard }) =>
        guard.canActivate(contexto('u-1')).catch((e: Error) => e.message),
      ),
    );

    expect(mensajes[0]).toBe(mensajes[1]);
  });
});
