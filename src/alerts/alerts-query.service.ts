import { Injectable } from '@nestjs/common';
import type { ProviderIncident } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { providerLabel } from './alerts.types';

export interface OwnAlert {
  id: string;
  service: string;
  provider: string;
  providerLabel: string;
  reason: string;
  hint: string | null;
  openedAt: Date;
  failureCount: number;
}

/** Sin `providerLabel`/`reason`/`hint`/`failureCount` para un usuario normal. */
export interface PlatformAlert {
  id: string;
  service: string;
  openedAt: Date;
  providerLabel?: string;
  reason?: string;
  hint?: string | null;
  failureCount?: number;
}

export interface PanelAlerts {
  own: OwnAlert[];
  platform: PlatformAlert[];
}

export interface PlatformIncidentRow {
  id: string;
  scope: string;
  service: string;
  provider: string;
  providerLabel: string;
  companyName: string | null;
  kind: string;
  reason: string;
  hint: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  failureCount: number;
  affectedCompanies: number;
}

const DAY_MS = 86_400_000;

function detalle(i: ProviderIncident): OwnAlert {
  return {
    id: i.id,
    service: i.service,
    provider: i.provider,
    providerLabel: providerLabel(i.provider),
    reason: i.reason,
    hint: i.hint,
    openedAt: i.openedAt,
    failureCount: i.failureCount,
  };
}

/**
 * Lecturas de incidentes. Todo por `raw` (la tabla queda fuera del
 * aislamiento automático: los de plataforma no son de ninguna empresa), así
 * que cada consulta filtra la empresa A MANO. Un usuario normal nunca recibe
 * el detalle interno de un incidente de plataforma.
 */
@Injectable()
export class AlertsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lo que ve el aviso del panel para la empresa activa. */
  async forCompany(companyId: string, userId: string): Promise<PanelAlerts> {
    const admin = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true },
    });
    const isAdmin = admin?.isPlatformAdmin === true;
    const own = await this.prisma.raw.providerIncident.findMany({
      where: { companyId, scope: 'company', resolvedAt: null },
      orderBy: { openedAt: 'asc' },
    });
    const platform = await this.prisma.raw.providerIncident.findMany({
      where: {
        scope: 'platform',
        resolvedAt: null,
        ...(isAdmin ? {} : { affectedCompanyIds: { has: companyId } }),
      },
      orderBy: { openedAt: 'asc' },
    });
    return {
      own: own.map(detalle),
      platform: platform.map((i) =>
        isAdmin
          ? detalle(i)
          : { id: i.id, service: i.service, openedAt: i.openedAt },
      ),
    };
  }

  /** Mantenedor: abiertos y cerrados en los últimos 7 días. */
  async listForPlatform(now = new Date()): Promise<PlatformIncidentRow[]> {
    const rows = await this.prisma.raw.providerIncident.findMany({
      where: {
        OR: [
          { resolvedAt: null },
          { resolvedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
        ],
      },
      orderBy: { openedAt: 'desc' },
      take: 200,
      include: { company: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      service: r.service,
      provider: r.provider,
      providerLabel: providerLabel(r.provider),
      companyName: r.company?.name ?? null,
      kind: r.kind,
      reason: r.reason,
      hint: r.hint,
      openedAt: r.openedAt,
      resolvedAt: r.resolvedAt,
      failureCount: r.failureCount,
      affectedCompanies: r.affectedCompanyIds.length,
    }));
  }
}
