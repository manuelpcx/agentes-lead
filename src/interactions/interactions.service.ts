import { Injectable } from '@nestjs/common';
import { Channel, Direction, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

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
}
