import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthedRequest } from '../auth/auth.types';

/**
 * Deja pasar solo a los administradores de la PLATAFORMA (nosotros), no a los
 * dueños de una empresa.
 *
 * Va después de `JwtAuthGuard` y consulta la marca en cada petición, no en el
 * token: quitarle el permiso a alguien tiene efecto de inmediato y no cuando
 * caduque su sesión. Es el guard más sensible del sistema — detrás de él se ve
 * el listado de todos los clientes — así que la comprobación es explícita y no
 * depende de nada que venga del cliente.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('Sesión inválida');
    }

    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true, isActive: true },
    });
    if (!user?.isActive || !user.isPlatformAdmin) {
      // Mismo mensaje exista o no el permiso: no se confirma desde fuera
      // quién es administrador de la plataforma.
      throw new ForbiddenException('No tienes acceso a esta sección');
    }
    return true;
  }
}
