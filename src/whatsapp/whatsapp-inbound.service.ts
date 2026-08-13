import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentTurnJobData } from '../agent/agent-turn.job';

/**
 * Orquesta un mensaje entrante de WhatsApp: resuelve/crea el lead por teléfono,
 * registra la interacción entrante y encola un turno del agente. Debe correr
 * dentro de un `TenantContext` con `companyId` (lo abre el guard o el webhook).
 */
@Injectable()
export class WhatsappInboundService {
  constructor(
    @InjectQueue(QUEUE_AGENT_TURN)
    private readonly agentQueue: Queue<AgentTurnJobData>,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
  ) {}

  async handleIncoming(
    phone: string,
    text: string,
  ): Promise<{ leadId: string }> {
    const companyId = TenantContext.requireCompanyId();
    const correlationId = TenantContext.get()?.correlationId ?? randomUUID();

    const lead = await this.leads.findOrCreateByPhone(phone, text);
    await this.interactions.register({
      leadId: lead.id,
      channel: Channel.whatsapp,
      direction: Direction.inbound,
      content: text,
      agentId: null,
    });

    await this.agentQueue.add('turn', {
      companyId,
      leadId: lead.id,
      correlationId,
    });

    return { leadId: lead.id };
  }
}
