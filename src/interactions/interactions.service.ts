import { Injectable } from '@nestjs/common';
import { Channel, Direction, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { GESTION_PROACTIVA } from '../followup/collection-floor';

/** Datos mínimos para registrar una interacción. */
export interface RegisterInteractionInput {
  leadId: string;
  channel: Channel;
  direction: Direction;
  content: string;
  /** Null si la envió un humano; id de agente en otro caso. */
  agentId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Cliente Prisma aceptable (permite uso dentro de transacciones). */
type PrismaLike = Pick<PrismaService['db'], 'interaction'>;

@Injectable()
export class InteractionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra una interacción sobre un lead. El `companyId` lo inyecta la
   * extensión multi-tenant a partir del contexto activo.
   */
  async register(
    input: RegisterInteractionInput,
    client: PrismaLike = this.prisma.db,
  ) {
    return client.interaction.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        leadId: input.leadId,
        channel: input.channel,
        direction: input.direction,
        content: input.content,
        agentId: input.agentId ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }

  /**
   * Última interacción del lead en un canal/dirección desde `since`. Se usa
   * para no repetir acciones costosas (p. ej. llamar dos veces seguidas).
   */
  async findRecent(
    leadId: string,
    channel: Channel,
    direction: Direction,
    since: Date,
  ) {
    return this.prisma.db.interaction.findFirst({
      where: { leadId, channel, direction, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /**
   * Gestiones proactivas del lead desde `since`: salientes por WhatsApp, correo
   * o llamada marcadas con `metadata.gestion`. Las respuestas a mensajes del
   * cliente no llevan la marca, así que no cuentan para los topes de cobranza.
   */
  async findProactiveSince(
    leadId: string,
    since: Date,
  ): Promise<Array<{ channel: Channel; occurredAt: Date }>> {
    return this.prisma.db.interaction.findMany({
      where: {
        leadId,
        direction: Direction.outbound,
        channel: { in: [Channel.whatsapp, Channel.email, Channel.call] },
        occurredAt: { gte: since },
        metadata: { path: ['gestion'], equals: GESTION_PROACTIVA },
      },
      orderBy: { occurredAt: 'desc' },
      select: { channel: true, occurredAt: true },
    });
  }
}
