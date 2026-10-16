import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PanelRole, ProviderIncident } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { resolvePanelUrl } from '../common/config/panel-url';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformEmailService } from '../email/platform-email.service';
import { IncidentEmail, openedEmail, resolvedEmail } from './incident-email';

/** Como máximo un correo de apertura cada 6 h por cuenta y proveedor. */
const OPEN_EMAIL_THROTTLE_MS = 6 * 60 * 60 * 1000;

/**
 * Correos de los incidentes de proveedores. Salen por el correo de la
 * PLATAFORMA (`PlatformEmailService`): no dependen de la cuenta de correo de
 * la empresa, que puede ser justo la que está fallando. A los dueños de la
 * empresa si la cuenta es suya; a los administradores si es de la plataforma.
 */
@Injectable()
export class IncidentNotifier {
  private readonly logger = new Logger(IncidentNotifier.name);
  private readonly panelUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: PlatformEmailService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.panelUrl = resolvePanelUrl(config);
  }

  /**
   * Avisa que se abrió un incidente. Si el mismo proveedor ya avisó hace
   * menos de 6 h (se recuperó y volvió a caer), no repite el correo: el aviso
   * del panel basta. Devuelve si mandó al menos un correo.
   */
  async opened(incident: ProviderIncident, now = new Date()): Promise<boolean> {
    const recent = await this.prisma.raw.providerIncident.findFirst({
      where: {
        key: incident.key,
        id: { not: incident.id },
        openNotifiedAt: {
          gte: new Date(now.getTime() - OPEN_EMAIL_THROTTLE_MS),
        },
      },
      select: { id: true },
    });
    if (recent) return false;

    const link = `${this.panelUrl}/${incident.scope === 'company' ? 'integrations' : 'platform'}`;
    const sent = await this.sendAll(
      incident,
      openedEmail(incident, await this.companyName(incident), link),
    );
    if (sent) {
      await this.prisma.raw.providerIncident.update({
        where: { id: incident.id },
        data: { openNotifiedAt: now },
      });
    }
    return sent;
  }

  /** Avisa que se cerró, solo si antes se avisó la apertura. */
  async resolved(incident: ProviderIncident, now = new Date()): Promise<void> {
    if (!incident.openNotifiedAt) return;
    await this.sendAll(
      incident,
      resolvedEmail(incident, await this.companyName(incident), now),
    );
  }

  /** Manda a cada destinatario; devuelve si al menos uno salió. */
  private async sendAll(
    incident: ProviderIncident,
    message: IncidentEmail,
  ): Promise<boolean> {
    const to = await this.recipients(incident);
    if (to.length === 0) {
      this.logger.warn(
        `Incidente ${incident.key} sin destinatarios para avisar.`,
      );
      return false;
    }
    let sent = 0;
    for (const address of to) {
      try {
        await this.email.send({ to: address, ...message });
        sent++;
      } catch (e) {
        this.logger.warn(
          `No se pudo avisar el incidente ${incident.key} a ${address}: ${(e as Error).message}`,
        );
      }
    }
    return sent > 0;
  }

  private async recipients(incident: ProviderIncident): Promise<string[]> {
    if (incident.scope === 'company' && incident.companyId) {
      const owners = await this.prisma.raw.membership.findMany({
        where: {
          companyId: incident.companyId,
          role: PanelRole.OWNER,
          user: { isActive: true },
        },
        select: { user: { select: { email: true } } },
      });
      return owners.map((m) => m.user.email);
    }
    const admins = await this.prisma.raw.user.findMany({
      where: { isPlatformAdmin: true, isActive: true },
      select: { email: true },
    });
    return admins.map((u) => u.email);
  }

  private async companyName(
    incident: ProviderIncident,
  ): Promise<string | null> {
    if (incident.scope !== 'company' || !incident.companyId) return null;
    const company = await this.prisma.raw.company.findUnique({
      where: { id: incident.companyId },
      select: { name: true },
    });
    return company?.name ?? null;
  }
}
