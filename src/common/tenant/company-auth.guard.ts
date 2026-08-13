import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { TenantContext } from './tenant-context';

/** Header que identifica a la empresa emisora (UUID de Company). */
const HEADER_COMPANY = 'x-company-id';
/** Header con la firma HMAC-SHA256 (hex) del cuerpo crudo. */
const HEADER_SIGNATURE = 'x-signature';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
  company?: { id: string; name: string };
}

/**
 * Autentica al emisor de un webhook por empresa: identifica la Company por
 * header, recomputa la firma HMAC del cuerpo crudo con su `webhookSecret`
 * (descifrado) y la compara en tiempo constante. Al validar, fija el
 * `companyId` en el `TenantContext` para que todo aguas abajo quede aislado.
 */
@Injectable()
export class CompanyAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithRawBody>();

    const companyId = this.header(req, HEADER_COMPANY);
    const signature = this.header(req, HEADER_SIGNATURE);
    if (!companyId || !signature) {
      throw new UnauthorizedException(
        `Faltan headers de autenticación (${HEADER_COMPANY}, ${HEADER_SIGNATURE})`,
      );
    }

    // Lookup por cliente crudo: Company no es una entidad tenant-scoped.
    const company = await this.prisma.raw.company.findFirst({
      where: { id: companyId, isActive: true },
      select: { id: true, name: true, webhookSecret: true },
    });
    if (!company) {
      throw new UnauthorizedException('Empresa no encontrada o inactiva');
    }

    const secret = this.crypto.decrypt(company.webhookSecret);
    const rawBody = req.rawBody ?? Buffer.from('');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    if (!this.crypto.safeEquals(signature, expected)) {
      throw new UnauthorizedException('Firma HMAC inválida');
    }

    // Fija el tenant en el contexto vivo (abierto por el middleware).
    const store = TenantContext.get();
    if (store) {
      store.companyId = company.id;
    }
    req.company = { id: company.id, name: company.name };

    return true;
  }

  private header(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
