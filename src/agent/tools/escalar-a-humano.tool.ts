import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ESCALAR_A_HUMANO } from './tool-names';

/**
 * Escala el lead a un humano: cambia estado a ESCALADO_HUMANO, lo pausa para el
 * agente y registra el motivo. Corta el turno.
 */
@Injectable()
export class EscalarAHumanoTool implements AgentTool {
  readonly name = TOOL_ESCALAR_A_HUMANO;
  readonly definition = {
    name: this.name,
    description:
      'Escala la conversación a un humano cuando no puedes resolver algo, no ' +
      'tienes el dato, el cliente lo pide o la situación lo amerita. Tras ' +
      'escalar, el agente deja de actuar sobre este lead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        motivo: {
          type: 'string',
          description: 'Motivo del escalamiento.',
        },
      },
      required: ['motivo'],
    },
  };

  constructor(
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const motivo = String(input.motivo ?? 'sin motivo especificado');
    await this.leads.escalateToHuman(ctx.lead.id);
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Escalado a humano: ${motivo}`,
      agentId: null,
      metadata: { motivo },
    });
    ctx.escalated = true;
    return {
      content: `Lead escalado a un humano (${motivo}). Termina el turno.`,
      stop: true,
    };
  }
}
