import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Channel, Direction } from '@prisma/client';
import { QUEUE_AGENT_TURN } from '../../queue/queue.constants';
import { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeadsService } from '../../leads/leads.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { AgentTurnJobData } from '../agent-turn.job';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_DERIVAR_A_AGENTE } from './tool-names';

/** Espera antes del turno del agente receptor (deja liberar el candado). */
const HANDOFF_DELAY_MS = 1_000;

/**
 * Traspasa la conversación a otro agente de la empresa (Fase 8). Entrega un
 * resumen de contexto, deja constancia como interacción `system` (marcada como
 * `derivacion` para la vista de handoffs), avisa al lead y encola un turno para
 * que el agente receptor responda al mismo mensaje. Corta el turno actual: a
 * partir de aquí manda el nuevo agente (`Lead.agentId`).
 */
@Injectable()
export class DerivarAAgenteTool implements AgentTool {
  private readonly logger = new Logger(DerivarAAgenteTool.name);
  readonly name = TOOL_DERIVAR_A_AGENTE;
  readonly definition = {
    name: this.name,
    description:
      'Traspasa la conversación a OTRO agente especializado de la empresa ' +
      'cuando el tema corresponde a su área (según la lista de agentes de tu ' +
      'contexto). Debes pasar un resumen de lo conversado para que continúe sin ' +
      'perder contexto. Tras derivar, dejas de actuar sobre este lead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agente: {
          type: 'string',
          description:
            'Nombre exacto del agente destino, tal como aparece en la lista de ' +
            'agentes de tu contexto.',
        },
        resumen: {
          type: 'string',
          description:
            'Resumen del contexto para el agente receptor: qué pide el cliente, ' +
            'qué se hizo y qué falta.',
        },
        motivo: {
          type: 'string',
          description: 'Motivo breve de la derivación.',
        },
      },
      required: ['agente', 'resumen'],
    },
  };

  constructor(
    @InjectQueue(QUEUE_AGENT_TURN)
    private readonly agentQueue: Queue<AgentTurnJobData>,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const nombre = String(input.agente ?? '').trim();
    const resumen = String(input.resumen ?? '').trim();
    const motivo = String(input.motivo ?? 'derivación por área');

    if (!nombre || !resumen) {
      return {
        content:
          'Faltan datos: indica el nombre del agente destino y un resumen.',
        isError: true,
      };
    }

    // Busca el destino entre los agentes activos, excluyendo al que deriva.
    const destino = await this.prisma.db.agent.findFirst({
      where: {
        isActive: true,
        name: { equals: nombre, mode: 'insensitive' },
        id: { not: ctx.agentId },
      },
    });
    if (!destino) {
      return {
        content:
          `No existe un agente activo llamado "${nombre}" distinto de ti. ` +
          'Revisa la lista de agentes de tu contexto y usa el nombre exacto.',
        isError: true,
      };
    }

    // Reasigna al nuevo agente (fuente de verdad del "a cargo").
    await this.leads.reassignAgent(ctx.lead.id, destino.id);
    ctx.derived = true;

    // Constancia interna del traspaso (marca `derivacion` para handoffs).
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Derivado a ${destino.name}: ${resumen}`,
      agentId: ctx.agentId,
      metadata: {
        kind: 'derivacion',
        fromAgentId: ctx.agentId,
        toAgentId: destino.id,
        toAgentName: destino.name,
        motivo,
        resumen,
      },
    });

    if (ctx.followUp) {
      // Turno proactivo (seguimiento/primer contacto): no hay un mensaje del
      // cliente al que responder. NO se avisa (confundiría) y se programa al
      // receptor para que contacte YA de forma proactiva (el cron lo ejecuta).
      // No cuenta como intento (ctx.derived corta el conteo en el seguimiento).
      await this.leads.scheduleNextAction(
        ctx.lead.id,
        new Date(),
        'primer_contacto',
      );
    } else {
      // Respuesta en vivo: el cliente está esperando. Avísale que sigue otro
      // equipo y encola un turno de respuesta para que el receptor conteste.
      if (ctx.lead.phone) {
        const aviso =
          'Te comunico con nuestro equipo especializado para ayudarte mejor. ' +
          'En un momento continúan contigo.';
        await this.whatsapp.send(ctx.lead.phone, aviso);
        await this.interactions.register({
          leadId: ctx.lead.id,
          channel: Channel.whatsapp,
          direction: Direction.outbound,
          content: aviso,
          agentId: ctx.agentId,
        });
      }
      // Demora corta: este turno todavía tiene tomado el candado del lead
      // (`TurnLockService`), y el turno del receptor no puede arrancar hasta
      // que se libere. Sin la demora entraría al ciclo de reintentos y el
      // cliente esperaría bastante más.
      await this.agentQueue.add(
        'turn',
        {
          companyId: TenantContext.requireCompanyId(),
          leadId: ctx.lead.id,
          correlationId: TenantContext.get()?.correlationId ?? randomUUID(),
        },
        { delay: HANDOFF_DELAY_MS },
      );
    }

    this.logger.log(
      `Lead ${ctx.lead.id} derivado de ${ctx.agentId} a ${destino.id} ` +
        `(${destino.name}); proactivo=${!!ctx.followUp}`,
    );
    return {
      content: `Conversación derivada a ${destino.name}. Termina tu turno.`,
      stop: true,
    };
  }
}
