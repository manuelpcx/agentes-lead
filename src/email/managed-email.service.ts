import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailDomain, Prisma } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { byoEmailProvider } from './byo-email';
import { EmailQuotaService } from './email-quota.service';
import {
  ResendApiError,
  ResendDnsRecord,
  ResendDomain,
  ResendDomainsClient,
  SENDABLE_DOMAIN_STATUSES,
  recordFqdn,
} from './resend-domains.client';

/** Parte local por defecto en el dominio propio: contacto@su-dominio. */
const DEFAULT_LOCAL_PART = 'contacto';

/** Con estos estados Resend sigue revisando los DNS: vale la pena preguntar. */
const IN_PROGRESS_STATUSES = [
  'not_started',
  'pending',
  'temporary_failure',
  'partially_failed',
];

/** No se le pregunta a Resend más seguido que esto al abrir el panel. */
const MIN_REFRESH_MS = 60 * 1000;

/** Por dónde sale el correo de una empresa. */
export type EmailSendingMode = 'byo' | 'managed' | 'shared' | 'none';

/** Remitente que configura la empresa (en `channelsConfig.email`). */
export interface EmailSenderSettings {
  fromName?: string;
  localPart?: string;
  replyTo?: string;
}

/** Remitente con el que sale un correo por la cuenta de la plataforma. */
export interface PlatformSender {
  mode: 'managed' | 'shared';
  from: string;
  replyTo?: string;
}

export interface ManagedEmailStatus {
  /** El servidor tiene la cuenta de Resend de la plataforma (RESEND_API_KEY). */
  available: boolean;
  sharedDomain: string | null;
  sender: EmailSenderSettings;
  domain: {
    domain: string;
    status: string;
    sendable: boolean;
    verifiedAt: Date | null;
    lastCheckedAt: Date | null;
    records: Array<ResendDnsRecord & { fqdn: string }>;
  } | null;
  sending: {
    mode: EmailSendingMode;
    from: string | null;
    replyTo: string | null;
  };
  quota: { used: number; limit: number };
}

/**
 * Correo gestionado: las empresas envían por la cuenta de Resend de la
 * PLATAFORMA, con su propio dominio (que damos de alta nosotros y ellas solo
 * configuran en su DNS) o, mientras lo verifican, desde el dominio compartido
 * de la plataforma con su nombre como remitente.
 */
@Injectable()
export class ManagedEmailService {
  private readonly logger = new Logger(ManagedEmailService.name);
  private readonly apiKey?: string;
  private readonly sharedDomain?: string;
  private readonly sharedLocalPart: string;
  private readonly region: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly quota: EmailQuotaService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.apiKey = config.get('RESEND_API_KEY', { infer: true }) || undefined;
    this.sharedDomain =
      config.get('EMAIL_SHARED_DOMAIN', { infer: true }) || undefined;
    this.sharedLocalPart = config.get('EMAIL_SHARED_LOCAL_PART', {
      infer: true,
    });
    this.region = config.get('RESEND_DOMAIN_REGION', { infer: true });
  }

  /** API key de la plataforma para enviar (undefined: correo gestionado apagado). */
  get platformApiKey(): string | undefined {
    return this.apiKey;
  }

  /**
   * Remitente para un correo que sale por la cuenta de la plataforma: el
   * dominio propio si ya está verificado; si no, el compartido. null si no
   * hay ninguno (o el servidor no tiene la cuenta de Resend).
   */
  async platformSender(companyId: string): Promise<PlatformSender | null> {
    if (!this.apiKey) {
      return null;
    }
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { name: true, channelsConfig: true },
    });
    const sender = parseSender(company?.channelsConfig);
    const displayName = sender.fromName || company?.name || 'Notificaciones';
    const domain = await this.prisma.raw.emailDomain.findUnique({
      where: { companyId },
    });
    if (domain && SENDABLE_DOMAIN_STATUSES.has(domain.status)) {
      return {
        mode: 'managed',
        from: formatFrom(
          displayName,
          `${sender.localPart || DEFAULT_LOCAL_PART}@${domain.domain}`,
        ),
        replyTo: sender.replyTo,
      };
    }
    if (this.sharedDomain) {
      return {
        mode: 'shared',
        from: formatFrom(
          displayName,
          `${this.sharedLocalPart}@${this.sharedDomain}`,
        ),
        replyTo: sender.replyTo,
      };
    }
    return null;
  }

  /** Estado del correo de la empresa activa, para el panel. */
  async status(): Promise<ManagedEmailStatus> {
    const companyId = TenantContext.requireCompanyId();
    let row = await this.prisma.db.emailDomain.findFirst();
    if (row && this.shouldRefresh(row)) {
      row = await this.refresh(row).catch((e: Error) => {
        this.logger.warn(
          `No se pudo consultar el dominio en Resend: ${e.message}`,
        );
        return row as EmailDomain;
      });
    }

    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { channelsConfig: true },
    });
    const byo = await this.credentials.get('email');
    let sending: ManagedEmailStatus['sending'];
    if (byoEmailProvider(byo)) {
      sending = {
        mode: 'byo',
        from: String(byo?.config.from ?? ''),
        replyTo: null,
      };
    } else {
      const platform = await this.platformSender(companyId);
      sending = platform
        ? {
            mode: platform.mode,
            from: platform.from,
            replyTo: platform.replyTo ?? null,
          }
        : { mode: 'none', from: null, replyTo: null };
    }

    return {
      available: !!this.apiKey,
      sharedDomain: this.sharedDomain ?? null,
      sender: parseSender(company?.channelsConfig),
      domain: row ? domainView(row) : null,
      sending,
      quota: {
        used: await this.quota.used(companyId),
        limit: this.quota.limit,
      },
    };
  }

  /** Guarda el remitente. Un campo vacío lo borra (vuelve al valor por defecto). */
  async updateSender(dto: EmailSenderSettings): Promise<ManagedEmailStatus> {
    const companyId = TenantContext.requireCompanyId();
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { channelsConfig: true },
    });
    const channels = (company?.channelsConfig ?? {}) as Record<string, unknown>;
    const email = { ...((channels.email ?? {}) as Record<string, unknown>) };
    for (const key of ['fromName', 'localPart', 'replyTo'] as const) {
      const value = dto[key];
      if (value === undefined) {
        continue;
      }
      const clean =
        key === 'fromName' ? value.trim() : value.trim().toLowerCase();
      if (clean) {
        email[key] = clean;
      } else {
        delete email[key];
      }
    }
    await this.prisma.raw.company.update({
      where: { id: companyId },
      data: {
        channelsConfig: { ...channels, email } as Prisma.InputJsonValue,
      },
    });
    return this.status();
  }

  /**
   * Da de alta el dominio de la empresa en la cuenta de Resend de la
   * plataforma y dispara la verificación de inmediato: Resend revisa los DNS
   * por 72 h, así que el dominio se verifica solo cuando la empresa crea los
   * registros.
   */
  async addDomain(input: string): Promise<ManagedEmailStatus> {
    const client = this.requireClient();
    const companyId = TenantContext.requireCompanyId();
    const domain = input.trim().toLowerCase().replace(/\.$/, '');

    if (
      this.sharedDomain &&
      (domain === this.sharedDomain || domain.endsWith(`.${this.sharedDomain}`))
    ) {
      throw new BadRequestException('Ese dominio es de la plataforma.');
    }
    if (await this.prisma.db.emailDomain.findFirst()) {
      throw new ConflictException(
        'Ya tienes un dominio. Quítalo antes de agregar otro.',
      );
    }
    if (await this.prisma.raw.emailDomain.findUnique({ where: { domain } })) {
      throw new ConflictException(
        'Ese dominio ya está registrado por otra empresa en la plataforma.',
      );
    }

    const created = await client
      .create(domain, this.region)
      .catch((e: unknown) => rethrow(e));
    try {
      await client.verify(created.id).catch((e: Error) =>
        // No es fatal: queda en not_started y se puede verificar desde el panel.
        this.logger.warn(`No se pudo iniciar la verificación: ${e.message}`),
      );
      const current: ResendDomain = await client
        .get(created.id)
        .catch(() => created);
      await this.prisma.db.emailDomain.create({
        data: {
          companyId,
          domain,
          resendDomainId: created.id,
          status: current.status,
          records: (current.records ??
            created.records ??
            []) as unknown as Prisma.InputJsonValue,
          lastCheckedAt: new Date(),
          verifiedAt: SENDABLE_DOMAIN_STATUSES.has(current.status)
            ? new Date()
            : null,
        },
      });
    } catch (e) {
      // Si no quedó guardado, que no quede huérfano en Resend.
      await client.remove(created.id).catch(() => undefined);
      throw e;
    }
    this.logger.log(
      `Dominio de correo dado de alta: ${domain} (companyId=${companyId})`,
    );
    return this.status();
  }

  /** Vuelve a pedirle a Resend que revise los DNS (botón "Verificar"). */
  async verifyDomain(): Promise<ManagedEmailStatus> {
    const client = this.requireClient();
    const row = await this.requireDomain();
    await client.verify(row.resendDomainId).catch((e: unknown) => rethrow(e));
    await this.refresh(row);
    return this.status();
  }

  /** Quita el dominio de Resend y de la plataforma. */
  async removeDomain(): Promise<ManagedEmailStatus> {
    const client = this.requireClient();
    const row = await this.requireDomain();
    await client.remove(row.resendDomainId).catch((e: unknown) => rethrow(e));
    await this.prisma.db.emailDomain.deleteMany({ where: { id: row.id } });
    this.logger.log(`Dominio de correo quitado: ${row.domain}`);
    return this.status();
  }

  /**
   * Revisa en Resend los dominios que siguen verificándose (todas las
   * empresas). Lo llama el scheduler: así el correo pasa a salir por el
   * dominio propio apenas queda verificado, aunque nadie abra el panel.
   */
  async refreshPendingDomains(): Promise<number> {
    if (!this.apiKey) {
      return 0;
    }
    const desde = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const pendientes = await this.prisma.raw.emailDomain.findMany({
      where: {
        status: { in: IN_PROGRESS_STATUSES },
        updatedAt: { gte: desde },
      },
      take: 50,
    });
    for (const row of pendientes) {
      await this.refresh(row).catch((e: Error) =>
        this.logger.warn(`No se pudo revisar ${row.domain}: ${e.message}`),
      );
    }
    return pendientes.length;
  }

  // ─────────────────────── privados ───────────────────────

  private shouldRefresh(row: EmailDomain): boolean {
    return (
      !!this.apiKey &&
      IN_PROGRESS_STATUSES.includes(row.status) &&
      (!row.lastCheckedAt ||
        Date.now() - row.lastCheckedAt.getTime() > MIN_REFRESH_MS)
    );
  }

  /** Trae el estado del dominio desde Resend y lo guarda (sin filtro de tenant: id explícito). */
  private async refresh(row: EmailDomain): Promise<EmailDomain> {
    const fresh = await this.requireClient().get(row.resendDomainId);
    const sendable = SENDABLE_DOMAIN_STATUSES.has(fresh.status);
    return this.prisma.raw.emailDomain.update({
      where: { id: row.id },
      data: {
        status: fresh.status,
        records: (fresh.records ??
          row.records) as unknown as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
        verifiedAt: sendable ? (row.verifiedAt ?? new Date()) : row.verifiedAt,
      },
    });
  }

  private requireClient(): ResendDomainsClient {
    if (!this.apiKey) {
      throw new BadRequestException(
        'El correo gestionado no está disponible en este servidor (falta ' +
          'RESEND_API_KEY).',
      );
    }
    return new ResendDomainsClient(this.apiKey);
  }

  private async requireDomain(): Promise<EmailDomain> {
    const row = await this.prisma.db.emailDomain.findFirst();
    if (!row) {
      throw new BadRequestException('No hay un dominio de correo configurado.');
    }
    return row;
  }
}

/** Remitente guardado en `channelsConfig.email` (tolerante a basura). */
export function parseSender(channelsConfig: unknown): EmailSenderSettings {
  const email = (channelsConfig as { email?: Record<string, unknown> } | null)
    ?.email;
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return {
    fromName: str(email?.fromName),
    localPart: str(email?.localPart),
    replyTo: str(email?.replyTo),
  };
}

/**
 * `"Nombre" <direccion>`. Se sacan comillas, `<>` y saltos de línea del
 * nombre: con ellos se podría romper la cabecera From.
 */
export function formatFrom(name: string, address: string): string {
  const clean = name
    .replace(/["\\<>\r\n]/g, '')
    .trim()
    .slice(0, 80);
  return clean ? `"${clean}" <${address}>` : address;
}

function domainView(
  row: EmailDomain,
): NonNullable<ManagedEmailStatus['domain']> {
  const records = Array.isArray(row.records)
    ? (row.records as unknown as ResendDnsRecord[])
    : [];
  return {
    domain: row.domain,
    status: row.status,
    sendable: SENDABLE_DOMAIN_STATUSES.has(row.status),
    verifiedAt: row.verifiedAt,
    lastCheckedAt: row.lastCheckedAt,
    records: records.map((r) => ({
      ...r,
      fqdn: recordFqdn(r.name, row.domain),
    })),
  };
}

/** Error de Resend → 400 con su mensaje (legible en el panel); el resto sigue igual. */
function rethrow(e: unknown): never {
  if (e instanceof ResendApiError) {
    throw new BadRequestException(e.message);
  }
  throw e;
}
