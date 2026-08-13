import { Injectable } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ACTUALIZAR_ESTADO_LEAD } from './tool-names';

const ESTADOS = Object.values(LeadStatus);

/** Actualiza el estado del embudo del lead y, opcionalmente, la próxima acción. */
@Injectable()
export class ActualizarEstadoLeadTool implements AgentTool {
  readonly name = TOOL_ACTUALIZAR_ESTADO_LEAD;
  readonly definition = {
    name: this.name,
    description:
      'Actualiza el estado del lead en el embudo cuando la conversación avanza ' +
      '(por ejemplo a EN_CONVERSACION, AGENDADO, CERRADO_GANADO/PERDIDO). ' +
      'Opcionalmente programa la próxima acción de seguimiento.',
    input_schema: {
      type: 'object' as const,
      properties: {
        estado: {
          type: 'string',
          enum: ESTADOS,
          description: 'Nuevo estado del lead.',
        },
        proximaAccionEn: {
          type: 'string',
          description:
            'Fecha/hora ISO 8601 para la próxima acción de seguimiento (opcional).',
        },
        tipoProximaAccion: {
          type: 'string',
          description: 'Descripción breve de la próxima acción (opcional).',
        },
      },
      required: ['estado'],
    },
  };

  constructor(private readonly leads: LeadsService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const estado = input.estado as LeadStatus;
    if (!ESTADOS.includes(estado)) {
      return {
        content: `Estado inválido: ${String(input.estado)}`,
        isError: true,
      };
    }

    await this.leads.updateStatus(ctx.lead.id, estado);

    const proximaAccionEn = input.proximaAccionEn
      ? new Date(String(input.proximaAccionEn))
      : null;
    if (proximaAccionEn && !Number.isNaN(proximaAccionEn.getTime())) {
      await this.leads.scheduleNextAction(
        ctx.lead.id,
        proximaAccionEn,
        String(input.tipoProximaAccion ?? 'seguimiento'),
      );
    }

    return { content: `Estado del lead actualizado a ${estado}.` };
  }
}
