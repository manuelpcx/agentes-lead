import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Canales que pueden tener credenciales propias por empresa. */
export type IntegrationChannel = 'whatsapp' | 'email' | 'voice' | 'crm';

/** Credencial resuelta (secretos YA descifrados). Solo para uso interno del backend. */
export interface ResolvedCredential {
  provider: string;
  config: Record<string, unknown>;
  secret?: string;
  /** Secreto de firma de webhooks (si el proveedor lo separa del secreto de API). */
  webhookSecret?: string;
  isActive: boolean;
}

/** Estado de una integración para el panel (SIN los secretos). */
export interface IntegrationStatus {
  channel: string;
  provider: string;
  config: Record<string, unknown>;
  configured: boolean;
  webhookSecretConfigured: boolean;
  isActive: boolean;
}

/**
 * Datos para guardar una integración. `secret`/`webhookSecret` opcionales: si
 * no vienen, se conserva lo ya guardado.
 */
export interface UpsertCredential {
  provider: string;
  config?: Record<string, unknown>;
  secret?: string;
  webhookSecret?: string;
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

  /** Resuelve la credencial (con secretos descifrados) de la empresa activa. */
  async get(channel: IntegrationChannel): Promise<ResolvedCredential | null> {
    return this.getByCompanyId(TenantContext.requireCompanyId(), channel);
  }

  /**
   * Igual que `get`, pero con `companyId` explícito en vez del `TenantContext`.
   * La usan los guards/controllers de webhook: necesitan resolver el secreto de
   * la empresa (para verificar la firma) ANTES de poder abrir su TenantContext
   * (que depende de que ese companyId ya esté confirmado).
   */
  async getByCompanyId(
    companyId: string,
    channel: IntegrationChannel,
  ): Promise<ResolvedCredential | null> {
    const it = await this.prisma.raw.integration.findFirst({
      where: { companyId, channel },
    });
    if (!it) {
      return null;
    }
    return {
      provider: it.provider,
      config: (it.config ?? {}) as Record<string, unknown>,
      secret: it.secretEnc ? this.crypto.decrypt(it.secretEnc) : undefined,
      webhookSecret: it.webhookSecretEnc
        ? this.crypto.decrypt(it.webhookSecretEnc)
        : undefined,
      isActive: it.isActive,
    };
  }

  /** Guarda/actualiza la credencial. Cifra los secretos que vengan. */
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
      ...(dto.webhookSecret
        ? { webhookSecretEnc: this.crypto.encrypt(dto.webhookSecret) }
        : {}),
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
          webhookSecretEnc: dto.webhookSecret
            ? this.crypto.encrypt(dto.webhookSecret)
            : null,
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
      webhookSecretConfigured: !!it.webhookSecretEnc,
      isActive: it.isActive,
    }));
  }
}
