import { Injectable } from '@nestjs/common';
import { AgentMetric, Channel, Direction, LeadStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/** Canales de conversación real (excluye eventos de sistema). */
const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

/** Inicio del día (UTC) de una fecha. */
function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula y persiste las métricas del día para una empresa. Idempotente
   * (upsert por empresa/tipo/día). Usa el cliente crudo (corre sin contexto de
   * tenant, con `companyId` explícito).
   */
  async computeDaily(companyId: string, day: Date): Promise<void> {
    const start = startOfDayUtc(day);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const inDay = { gte: start, lt: end };

    const [leadsNuevos, citas, entrantes, salientes, escalamientos] =
      await Promise.all([
        this.prisma.raw.lead.count({
          where: { companyId, createdAt: inDay },
        }),
        this.prisma.raw.appointment.count({
          where: { companyId, createdAt: inDay },
        }),
        this.prisma.raw.interaction.count({
          where: {
            companyId,
            direction: Direction.inbound,
            channel: { in: CONVERSATION_CHANNELS },
            occurredAt: inDay,
          },
        }),
        this.prisma.raw.interaction.count({
          where: {
            companyId,
            direction: Direction.outbound,
            channel: { in: CONVERSATION_CHANNELS },
            occurredAt: inDay,
          },
        }),
        this.prisma.raw.lead.count({
          where: {
            companyId,
            status: LeadStatus.ESCALADO_HUMANO,
            updatedAt: inDay,
          },
        }),
      ]);

    const values: Record<string, number> = {
      leads_nuevos: leadsNuevos,
      citas_agendadas: citas,
      mensajes_entrantes: entrantes,
      mensajes_salientes: salientes,
      escalamientos,
    };

    for (const [metricType, value] of Object.entries(values)) {
      await this.prisma.raw.agentMetric.upsert({
        where: {
          companyId_metricType_date: { companyId, metricType, date: start },
        },
        create: { companyId, date: start, metricType, value },
        update: { value },
      });
    }
  }

  /** Devuelve las métricas de una empresa en un rango de fechas. */
  async query(companyId: string, from: Date, to: Date): Promise<AgentMetric[]> {
    return this.prisma.raw.agentMetric.findMany({
      where: {
        companyId,
        date: { gte: startOfDayUtc(from), lte: startOfDayUtc(to) },
      },
      orderBy: [{ date: 'desc' }, { metricType: 'asc' }],
    });
  }
}
