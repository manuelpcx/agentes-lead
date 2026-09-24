import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { assertSafeOutboundUrl } from '../common/safe-url';

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
    if (channel === 'crm' && dto.config) {
      await this.assertCrmUrls(dto.config);
    }
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
    if (channel === 'whatsapp' && dto.config) {
      await this.syncWhatsappRouting(companyId, dto.provider, dto.config);
    }
    return { ok: true };
  }

  /**
   * Los mensajes entrantes se enrutan a la empresa por
   * `Company.channelsConfig.whatsapp` (el número de negocio con YCloud, el
   * Phone Number ID con Meta), que se editaba aparte, en Configuración. Es el
   * mismo dato que el de esta integración: si faltaba allá, el cliente pegaba
   * el webhook, todo parecía bien y los mensajes se descartaban en silencio.
   * Al guardar la integración se copia; el resto de channelsConfig no se toca.
   */
  private async syncWhatsappRouting(
    companyId: string,
    provider: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    let patch: Record<string, string> | null = null;
    if (provider === 'ycloud') {
      const phone = normalizeE164(config.from);
      patch = phone ? { phoneNumber: phone } : null;
    } else if (provider === 'meta') {
      const id =
        typeof config.phoneNumberId === 'string'
          ? config.phoneNumberId.trim()
          : '';
      patch = id ? { phoneNumberId: id } : null;
    }
    if (!patch) {
      return;
    }

    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { channelsConfig: true },
    });
    const channels = (company?.channelsConfig ?? {}) as Record<string, unknown>;
    const whatsapp = (channels.whatsapp ?? {}) as Record<string, unknown>;
    await this.prisma.raw.company.update({
      where: { id: companyId },
      data: {
        channelsConfig: {
          ...channels,
          whatsapp: { ...whatsapp, ...patch },
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Las URLs del CRM las va a llamar el SERVIDOR, así que se validan al
   * guardarlas (feedback inmediato en el panel) además de al usarlas.
   */
  private async assertCrmUrls(config: Record<string, unknown>): Promise<void> {
    for (const key of ['url', 'queryUrl']) {
      const value = config[key];
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }
      try {
        await assertSafeOutboundUrl(value.trim());
      } catch (e) {
        throw new BadRequestException(
          `La URL "${key}" no sirve: ${(e as Error).message}.`,
        );
      }
    }
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

/**
 * Número en E.164 (`+56911111111`) a partir de lo que escribió el cliente
 * ("+56 9 1111 1111", "56911111111"). YCloud manda el número de destino así,
 * y el enrutamiento compara texto exacto. Devuelve null si no parece número.
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const compact = raw.replace(/[\s\-().]/g, '');
  const withPlus = compact.startsWith('+') ? compact : `+${compact}`;
  return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
}
