import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { AuthedRequest } from '../auth/auth.types';
import { TenantContext } from '../common/tenant/tenant-context';

/** Mensaje único para todo fallo de llave: no se dice qué falló exactamente. */
const INVALID = 'Llave de API inválida';

/**
 * Autentica por llave de API en vez de por JWT + `X-Company-Id`. Sustituye a
 * `JwtAuthGuard` + `CompanyGuard` en las rutas de `/api/v1` (las que consume
 * el servidor MCP).
 *
 * Deja el request con la misma forma que el camino del panel (`req.user` y
 * `req.membership`), así `RolesGuard`, `@CurrentUser()` y `@CurrentMembership()`
 * siguen funcionando sin cambios, y fija el `companyId` en el `TenantContext`
 * para que la extensión de Prisma aísle igual que siempre.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = extractKey(req);
    if (!raw) {
      throw new UnauthorizedException(
        'Falta la llave de API (header Authorization: Bearer … o X-Api-Key)',
      );
    }

    const identity = await this.apiKeys.verify(raw);
    if (!identity) {
      throw new UnauthorizedException(INVALID);
    }
    // Sin un usuario responsable detrás no hay a quién auditar. No debería
    // pasar (la llave siempre se crea desde una sesión), pero si pasa se
    // rechaza en vez de escribir cosas a nombre de nadie.
    if (!identity.actingUserId) {
      throw new UnauthorizedException(INVALID);
    }

    // La empresa la manda la llave, no el cliente. Si alguien intenta apuntar
    // a otra con el header, se corta acá: nunca "se le hace caso" al header.
    const header = req.headers['x-company-id'];
    const requested = Array.isArray(header) ? header[0] : header;
    if (requested && requested !== identity.companyId) {
      throw new ForbiddenException('Esa llave no pertenece a esa empresa');
    }

    req.user = {
      userId: identity.actingUserId,
      email: `api-key:${identity.apiKeyId}`,
    };
    req.membership = { companyId: identity.companyId, role: identity.role };

    const store = TenantContext.get();
    if (store) {
      store.companyId = identity.companyId;
    }
    return true;
  }
}

/** Saca la llave de `Authorization: Bearer …` o de `X-Api-Key`. */
function extractKey(req: AuthedRequest): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const header = req.headers['x-api-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}
