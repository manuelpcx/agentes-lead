import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { AuthedRequest } from '../auth.types';
import { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Requiere `JwtAuthGuard` previo. Toma la empresa seleccionada de `X-Company-Id`,
 * verifica que el usuario tenga membresía y fija el `companyId` en el
 * `TenantContext` (aislamiento). Adjunta `req.membership` con el rol.
 */
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new UnauthorizedException('No autenticado');
    }
    const header = req.headers['x-company-id'];
    const companyId = Array.isArray(header) ? header[0] : header;
    if (!companyId) {
      throw new BadRequestException('Falta el header X-Company-Id');
    }

    const role = await this.auth.roleFor(req.user.userId, companyId);
    if (!role) {
      throw new ForbiddenException('No tienes acceso a esa empresa');
    }

    req.membership = { companyId, role };
    const store = TenantContext.get();
    if (store) {
      store.companyId = companyId;
    }
    return true;
  }
}
