import { Injectable } from '@nestjs/common';
import { Channel, Direction, LeadQualification } from '@prisma/client';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_CALIFICAR_LEAD } from './tool-names';

const NIVELES = Object.values(LeadQualification);

/**
 * Registra la calificación de interés/urgencia real del lead — distinta de
 * `actualizarEstadoLead` (esa es la etapa del embudo). Queda persistida y se
 * le vuelve a mostrar al agente en el contexto (ver ContextBuilder), para que
 * no tenga que re-derivarla leyendo toda la conversación en cada turno.
 */
@Injectable()
export class CalificarLeadTool implements AgentTool {
  readonly name = TOOL_CALIFICAR_LEAD;
  readonly definition = {
    name: this.name,
    description:
      'Califica el interés/urgencia real del lead (FRIO, TIBIO o CALIENTE) ' +
      'según las señales concretas que has visto en la conversación ' +
      '(presupuesto, urgencia, poder de decisión, interés real) — no es la ' +
      'etapa del embudo, eso es "actualizarEstadoLead". Úsala cuando tengas ' +
      'señales suficientes para calificar o recalificar, no en cada turno.',
    input_schema: {
      type: 'object' as const,
      properties: {
        nivel: {
          type: 'string',
          enum: NIVELES,
          description: 'FRIO, TIBIO o CALIENTE.',
        },
        motivo: {
          type: 'string',
          description: 'Por qué, en una frase (qué señal concreta viste).',
        },
      },
      required: ['nivel', 'motivo'],
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
    const nivel = String(input.nivel ?? '')
      .trim()
      .toUpperCase();
    if (!NIVELES.includes(nivel as LeadQualification)) {
      return {
        content: `Nivel inválido "${nivel}". Usa FRIO, TIBIO o CALIENTE.`,
        isError: true,
      };
    }
    const motivo = String(input.motivo ?? '').trim();
    if (!motivo) {
      return {
        content: 'Falta el motivo de la calificación.',
        isError: true,
      };
    }

    await this.leads.setQualification(
      ctx.lead.id,
      nivel as LeadQualification,
      motivo,
    );
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Lead calificado como ${nivel} — ${motivo}.`,
      agentId: ctx.agentId,
    });
    return { content: `Calificación registrada: ${nivel}.` };
  }
}
