import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthedRequest } from '../auth.types';

interface JwtPayload {
  sub: string;
  email: string;
  /** Emitido en (segundos Unix). Lo pone `@nestjs/jwt` al firmar. */
  iat?: number;
}

/**
 * Verifica el JWT del panel y adjunta `req.user`.
 *
 * Además de la firma y la expiración, consulta al usuario en cada petición
 * (una lectura por clave primaria) para poder **revocar** sesiones sin
 * esperar a que el token venza:
 * - usuario desactivado → fuera al instante;
 * - contraseña cambiada después de emitido el token → fuera (así un cambio
 *   de contraseña expulsa a quien tuviera la anterior).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token de autenticación');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const user = await this.prisma.raw.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, passwordChangedAt: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }
    // Se compara en segundos (la resolución de `iat`): un token emitido en el
    // mismo segundo del cambio —el que devuelve el propio cambio— sigue valiendo.
    if (
      user.passwordChangedAt &&
      payload.iat !== undefined &&
      Math.floor(user.passwordChangedAt.getTime() / 1000) > payload.iat
    ) {
      throw new UnauthorizedException(
        'La sesión caducó porque la contraseña cambió. Vuelve a entrar.',
      );
    }

    req.user = { userId: payload.sub, email: payload.email };
    return true;
  }
}
