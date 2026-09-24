import { Injectable, NotFoundException } from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Prefijo de todas nuestras llaves: se reconoce de un vistazo en un log. */
const KEY_PREFIX = 'ale';
/** Bytes aleatorios del secreto (32 bytes = 256 bits en base64url). */
const SECRET_BYTES = 32;
/** Caracteres del secreto que quedan visibles en el panel. */
const VISIBLE_CHARS = 6;

/** Llave tal como la ve el panel: sin el secreto. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** Algo como `ale_a1b2c3…` — suficiente para reconocerla, inútil para entrar. */
  prefix: string;
  role: PanelRole;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Resultado de crear una llave: la única vez que el secreto se ve. */
export interface CreatedApiKey extends ApiKeySummary {
  /** Llave completa en claro. No se puede volver a consultar. */
  key: string;
}

/** Identidad resuelta a partir de una llave válida. */
export interface ApiKeyIdentity {
  apiKeyId: string;
  companyId: string;
  role: PanelRole;
  /** Usuario que emitió la llave: es el responsable en la auditoría. */
  actingUserId: string | null;
}

/**
 * Llaves de API por empresa. Son la puerta de entrada del servidor MCP: un
 * proceso que corre en el computador de la persona y no puede andar con un
 * JWT de 15 minutos ni con la contraseña del panel.
 *
 * Seguridad:
 * - Se guarda **solo el SHA-256** de la llave. Si alguien se lleva la base de
 *   datos, no se lleva llaves usables.
 * - La llave se muestra UNA vez, al crearla. Después solo queda el prefijo.
 * - Por defecto la llave es SOLO_LECTURA: para que escriba hay que pedirlo.
 * - La auditoría apunta a quien la emitió, no a un usuario fantasma.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Crea una llave y devuelve el secreto (única vez que se puede leer). */
  async create(input: {
    name: string;
    role?: PanelRole;
    expiresAt?: Date | null;
    createdById: string;
  }): Promise<CreatedApiKey> {
    const companyId = TenantContext.requireCompanyId();
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const key = `${KEY_PREFIX}_${secret}`;

    const created = await this.prisma.db.apiKey.create({
      data: {
        companyId,
        name: input.name.trim(),
        prefix: `${KEY_PREFIX}_${secret.slice(0, VISIBLE_CHARS)}`,
        hash: hashKey(key),
        role: input.role ?? PanelRole.SOLO_LECTURA,
        expiresAt: input.expiresAt ?? null,
        createdById: input.createdById,
      },
    });

    await this.audit.record({
      userId: input.createdById,
      action: 'create_api_key',
      entity: 'ApiKey',
      entityId: created.id,
      newValue: { name: created.name, role: created.role },
    });

    return { ...toSummary(created), key };
  }

  /** Llaves de la empresa activa, sin secretos. */
  async list(): Promise<ApiKeySummary[]> {
    const keys = await this.prisma.db.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(toSummary);
  }

  /**
   * Revoca una llave. No se borra: queda el registro de que existió y cuándo
   * dejó de servir, que es lo que se quiere mirar cuando algo salió mal.
   */
  async revoke(id: string, userId: string): Promise<ApiKeySummary> {
    const existing = await this.prisma.db.apiKey.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Esa llave no existe');
    }
    const revoked = await this.prisma.db.apiKey.update({
      where: { id },
      data: { revokedAt: existing.revokedAt ?? new Date() },
    });
    await this.audit.record({
      userId,
      action: 'revoke_api_key',
      entity: 'ApiKey',
      entityId: id,
      previousValue: { name: existing.name, revokedAt: null },
    });
    return toSummary(revoked);
  }

  /**
   * Valida una llave recibida en una petición. Devuelve `null` si no sirve por
   * el motivo que sea — nunca dice CUÁL, para no ayudar a quien esté probando.
   *
   * Va por `prisma.raw` a propósito: acá todavía no hay contexto de tenant
   * (justamente lo estamos resolviendo), igual que `CredentialsService` al
   * verificar la firma de un webhook.
   */
  async verify(rawKey: string): Promise<ApiKeyIdentity | null> {
    const key = (rawKey ?? '').trim();
    if (!key.startsWith(`${KEY_PREFIX}_`)) {
      return null;
    }
    const hash = hashKey(key);
    const found = await this.prisma.raw.apiKey.findUnique({ where: { hash } });
    if (!found || !constantTimeEquals(found.hash, hash)) {
      return null;
    }
    if (found.revokedAt || (found.expiresAt && found.expiresAt <= new Date())) {
      return null;
    }

    // "Último uso" es lo que le permite a la persona notar una llave olvidada
    // que sigue entrando. No se espera a que termine: no debe frenar la
    // petición ni hacerla fallar si el update se cae.
    void this.prisma.raw.apiKey
      .update({ where: { id: found.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      apiKeyId: found.id,
      companyId: found.companyId,
      role: found.role,
      actingUserId: found.createdById,
    };
  }
}

/** SHA-256 en hex de la llave completa. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Comparación en tiempo constante. La búsqueda ya es por hash único (o sea,
 * por igualdad exacta), pero comparar así evita que un cambio futuro
 * introduzca sin querer una comparación que filtre información por el tiempo
 * que tarda.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function toSummary(row: {
  id: string;
  name: string;
  prefix: string;
  role: PanelRole;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    role: row.role,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
