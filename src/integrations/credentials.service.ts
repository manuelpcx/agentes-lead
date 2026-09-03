import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Canales que pueden tener credenciales propias por empresa. */
export type IntegrationChannel = 'whatsapp' | 'email' | 'voice';

/** Credencial resuelta (secreto YA descifrado). Solo para uso interno del backend. */
export interface ResolvedCredential {
  provider: string;
  config: Record<string, unknown>;
  secret?: string;
  isActive: boolean;
}

/** Estado de una integración para el panel (SIN el secreto). */
export interface IntegrationStatus {
  channel: string;
  provider: string;
  config: Record<string, unknown>;
  configured: boolean;
  isActive: boolean;
}

/** Datos para guardar una integración. `secret` opcional: si no viene, se conserva. */
export interface UpsertCredential {
  provider: string;
  config?: Record<string, unknown>;
  secret?: string;
  isActive?: boolean;
}

/**
 * Credenciales de proveedores por empresa (BYO). Guarda el secreto cifrado en
 * reposo (CryptoService) y lo descifra solo al resolver el proveedor. El secreto
 * NUNCA sale al panel; el panel ve `status()` (sin secreto).
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Resuelve la credencial (con secreto descifrado) de la empresa activa. */
  async get(channel: IntegrationChannel): Promise<ResolvedCredential | null> {
    const it = await this.prisma.db.integration.findFirst({
      where: { channel },
    });
    if (!it) {
      return null;
    }
    return {
      provider: it.provider,
      config: (it.config ?? {}) as Record<string, unknown>,
      secret: it.secretEnc ? this.crypto.decrypt(it.secretEnc) : undefined,
      isActive: it.isActive,
    };
  }

  /** Guarda/actualiza la credencial. Cifra el secreto si viene. */
  async upsert(channel: IntegrationChannel, dto: UpsertCredential) {
    const companyId = TenantContext.requireCompanyId();
    const existing = await this.prisma.db.integration.findFirst({
      where: { channel },
    });
    const data: Prisma.IntegrationUncheckedUpdateInput = {
      provider: dto.provider,
      ...(dto.config !== undefined
        ? { config: dto.config as Prisma.InputJsonValue }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.secret ? { secretEnc: this.crypto.encrypt(dto.secret) } : {}),
    };
    if (existing) {
      await this.prisma.db.integration.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.db.integration.create({
        data: {
          companyId,
          channel,
          provider: dto.provider,
          config: (dto.config ?? {}) as Prisma.InputJsonValue,
          isActive: dto.isActive ?? true,
          secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
        },
      });
    }
    return { ok: true };
  }

  /** Estado de todas las integraciones de la empresa, SIN secretos. */
  async status(): Promise<IntegrationStatus[]> {
    const all = await this.prisma.db.integration.findMany();
    return all.map((it) => ({
      channel: it.channel,
      provider: it.provider,
      config: (it.config ?? {}) as Record<string, unknown>,
      configured: !!it.secretEnc,
      isActive: it.isActive,
    }));
  }
}
