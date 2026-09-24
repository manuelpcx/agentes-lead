import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentTurnJobData } from '../agent/agent-turn.job';

/** Datos de una llamada finalizada (normalizados desde el webhook del proveedor). */
export interface CompletedCall {
  leadId: string;
  callId: string;
  /** Transcripción completa de la llamada (puede venir vacía). */
  transcript?: string;
  /** Resumen/análisis del proveedor, si lo hay. */
  summary?: string;
}

/**
 * Procesa una llamada finalizada: registra la transcripción como Interaction de
 * canal `call` (entrante) y encola un turno del agente para que retome el hilo
 * por texto según lo que se habló. Debe correr dentro de un `TenantContext`.
 */
@Injectable()
export class VoiceInboundService {
  constructor(
    @InjectQueue(QUEUE_AGENT_TURN)
    private readonly agentQueue: Queue<AgentTurnJobData>,
    private readonly interactions: InteractionsService,
  ) {}

  async handleCompletedCall(call: CompletedCall): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const correlationId = TenantContext.get()?.correlationId ?? randomUUID();

    const partes = [
      call.summary ? `Resumen: ${call.summary}` : null,
      call.transcript ? `Transcripción:\n${call.transcript}` : null,
    ].filter(Boolean);
    const content = partes.length ? partes.join('\n\n') : '(sin transcripción)';

    const interaction = await this.interactions.register({
      leadId: call.leadId,
      channel: Channel.call,
      direction: Direction.inbound,
      content,
      agentId: null,
      metadata: { callId: call.callId },
    });

    // Despierta al agente para que siga por texto (mandar link, agendar, etc.)
    // solo si hubo conversación real; una no-respuesta no da nada que retomar.
    // Sin demora (la llamada ya terminó), pero con `inboundAt` para que el
    // turno se omita si el cliente escribió algo después de colgar.
    if (call.transcript && call.transcript.trim()) {
      await this.agentQueue.add('turn', {
        companyId,
        leadId: call.leadId,
        correlationId,
        inboundAt: interaction.occurredAt.getTime(),
      });
    }
  }
}
