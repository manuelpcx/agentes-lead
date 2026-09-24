import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
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
  /** Ventana de agrupacion: cuanto espera el turno antes de correr. */
  private readonly debounceMs: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    @InjectQueue(QUEUE_AGENT_TURN)
    private readonly agentQueue: Queue<AgentTurnJobData>,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
  ) {
    this.debounceMs = config.get('AGENT_TURN_DEBOUNCE_MS', { infer: true });
  }

  /**
   * `wakeAgent: false` registra el mensaje sin despertar al agente. Se usa con
   * las reacciones (un pulgar arriba no merece una respuesta completa, pero si
   * queda en el historial).
   */
  async handleIncoming(
    phone: string,
    text: string,
    options: { wakeAgent?: boolean } = {},
  ): Promise<{ leadId: string }> {
    const companyId = TenantContext.requireCompanyId();
    const correlationId = TenantContext.get()?.correlationId ?? randomUUID();

    const lead = await this.leads.findOrCreateByPhone(phone, text);
    const interaction = await this.interactions.register({
      leadId: lead.id,
      channel: Channel.whatsapp,
      direction: Direction.inbound,
      content: text,
      agentId: null,
    });

    if (options.wakeAgent === false) {
      return { leadId: lead.id };
    }

    // El turno se demora `debounceMs` a proposito: si el cliente sigue
    // escribiendo, esos mensajes entran al mismo turno y se contesta una sola
    // vez. `inboundAt` deja que el job del ultimo mensaje descarte a los
    // anteriores (ver `AgentTurnProcessor`).
    await this.agentQueue.add(
      'turn',
      {
        companyId,
        leadId: lead.id,
        correlationId,
        inboundAt: interaction.occurredAt.getTime(),
      },
      this.debounceMs > 0 ? { delay: this.debounceMs } : {},
    );

    return { leadId: lead.id };
  }
}
