import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_CANCELAR_SEGUIMIENTO } from './tool-names';

/**
 * Cancela una llamada o seguimiento ya agendado. Es la única forma de limpiar
 * `nextActionAt`/`nextActionType` — `iniciarLlamada` y `registrarPromesaPago`
 * solo pueden fijarlos, nunca quitarlos. Sin esta tool, un "no me llames" o
 * "cancela esa llamada" del cliente no tiene forma de volverse persistente:
 * el seguimiento automático igual se ejecutaría más tarde.
 */
@Injectable()
export class CancelarSeguimientoTool implements AgentTool {
  readonly name = TOOL_CANCELAR_SEGUIMIENTO;
  readonly definition = {
    name: this.name,
    description:
      'Cancela una llamada o seguimiento que ya estaba agendado para este ' +
      'lead. Úsala de inmediato cuando la persona pida no ser llamada, pida ' +
      'cancelar/eliminar una llamada agendada, o retire un compromiso de ' +
      'contacto previo. Después de usarla, NO vuelvas a ofrecer ni agendar ' +
      'una llamada salvo que la persona lo pida de nuevo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        motivo: {
          type: 'string',
          description:
            'Por qué se cancela (ej. "cliente pidió no ser llamado").',
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
    const motivo = String(input.motivo ?? '').trim() || 'Solicitud del cliente';
    await this.leads.cancelNextAction(ctx.lead.id);
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Seguimiento/llamada cancelado: ${motivo}.`,
      agentId: ctx.agentId,
    });
    return {
      content:
        'Seguimiento cancelado. No vuelvas a ofrecer ni agendar una llamada ' +
        'salvo que el cliente lo pida de nuevo.',
    };
  }
}
