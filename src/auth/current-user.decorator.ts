import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest, AuthMembership, AuthUser } from './auth.types';

/** Inyecta el usuario autenticado (`req.user`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().user;
  },
);

/** Inyecta la membresía activa (`req.membership`: empresa + rol). */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthMembership | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().membership;
  },
);
