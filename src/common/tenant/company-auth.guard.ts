import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { EnvVars } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  verifyCompanySignatureV1,
  verifyCompanySignatureV2,
} from '../webhook-signature';
import { TenantContext } from './tenant-context';

/** Header que identifica a la empresa emisora (UUID de Company). */
const HEADER_COMPANY = 'x-company-id';
/** Header con la firma HMAC-SHA256 (hex). */
const HEADER_SIGNATURE = 'x-signature';
/** Header con el timestamp (ms Unix) que entra en la firma — esquema v2. */
const HEADER_TIMESTAMP = 'x-timestamp';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
  company?: { id: string; name: string };
}

/**
 * Autentica al emisor de un webhook por empresa: identifica la Company por
 * header, recomputa la firma HMAC con su `webhookSecret` (descifrado) y la
 * compara en tiempo constante. Al validar, fija el `companyId` en el
 * `TenantContext` para que todo aguas abajo quede aislado.
 *
 * Dos esquemas de firma:
 * - **v2** (con `X-Timestamp`): firma sobre `"<timestamp>.<cuerpo>"` y el
 *   timestamp debe estar dentro de ±5 min. Una petición capturada deja de
 *   servir a los 5 minutos.
 * - **v1** (sin timestamp): firma solo sobre el cuerpo — repetible para
 *   siempre. Se sigue aceptando con un aviso en logs mientras
 *   `WEBHOOK_REQUIRE_TIMESTAMP` sea false, para no cortar los flujos de n8n
 *   existentes de golpe; con true se rechaza.
 */
@Injectable()
export class CompanyAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompanyAuthGuard.name);
  private readonly requireTimestamp: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.requireTimestamp = config.get('WEBHOOK_REQUIRE_TIMESTAMP', {
      infer: true,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithRawBody>();

    const companyId = this.header(req, HEADER_COMPANY);
    const signature = this.header(req, HEADER_SIGNATURE);
    if (!companyId || !signature) {
      throw new UnauthorizedException(
        `Faltan headers de autenticación (${HEADER_COMPANY}, ${HEADER_SIGNATURE})`,
      );
    }

    // Valida el formato antes de tocar la BD: un `X-Company-Id` malformado no es
    // un UUID y haría fallar la query de Postgres (500). Se rechaza como 401.
    if (!isUUID(companyId)) {
      throw new UnauthorizedException('X-Company-Id inválido');
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
    const timestamp = this.header(req, HEADER_TIMESTAMP);

    if (timestamp !== undefined) {
      if (!verifyCompanySignatureV2(rawBody, signature, timestamp, secret)) {
        throw new UnauthorizedException(
          'Firma HMAC inválida o X-Timestamp fuera de la ventana de 5 minutos',
        );
      }
    } else {
      if (this.requireTimestamp) {
        throw new UnauthorizedException(
          'Falta el header X-Timestamp: la firma debe ser HMAC-SHA256 de ' +
            '"<timestamp>.<cuerpo>" (ver docs/GUIA_DE_USO.md §3.3)',
        );
      }
      if (!verifyCompanySignatureV1(rawBody, signature, secret)) {
        throw new UnauthorizedException('Firma HMAC inválida');
      }
      this.logger.warn(
        `Firma sin X-Timestamp (esquema v1, repetible) de companyId=${company.id}. ` +
          'Migra el flujo al esquema con timestamp; WEBHOOK_REQUIRE_TIMESTAMP=true lo exigirá.',
      );
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
