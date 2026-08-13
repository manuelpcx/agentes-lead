import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PanelRole } from '@prisma/client';
import { ROLES_KEY } from '../roles.decorator';
import { AuthedRequest } from '../auth.types';

/** Requiere `CompanyGuard` previo. Verifica que el rol tenga permiso. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PanelRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const role = req.membership?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Tu rol no permite esta acción');
    }
    return true;
  }
}
