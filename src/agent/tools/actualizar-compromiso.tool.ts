import { Injectable } from '@nestjs/common';
import { LeadsService } from '../../leads/leads.service';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { ESTADOS_FINALES, EstadoCompromiso } from '../../memory/commitments';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ACTUALIZAR_COMPROMISO } from './tool-names';
import { programarProximoCompromiso } from './commitment-schedule';

type EstadoFinal = Exclude<EstadoCompromiso, 'pendiente'>;

/**
 * Marca un compromiso con fecha como cumplido, incumplido o cancelado. Sin
 * esto, un pago que la persona ya confirmó se seguiría verificando, y un
 * "ya no hace falta que me escriban" no detendría el recontacto.
 */
@Injectable()
export class ActualizarCompromisoTool implements AgentTool {
  readonly name = TOOL_ACTUALIZAR_COMPROMISO;
  readonly definition = {
    name: this.name,
    description:
      'Marca un compromiso con fecha (los de la sección "Compromisos con esta ' +
      'persona", por su id [c1], [c2]…) como cumplido, incumplido o cancelado. ' +
      'Úsala cuando la persona confirme que pagó o que ya no hace falta el ' +
      'recontacto. Si da una fecha nueva, no la uses: registra la nueva ' +
      'promesa o recontacto, que reemplaza a la anterior.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Id del compromiso, ej. "c1".',
        },
        estado: {
          type: 'string',
          enum: [...ESTADOS_FINALES],
          description:
            '"cumplido" (lo hizo), "incumplido" (no lo hizo y no da fecha ' +
            'nueva) o "cancelado" (ya no aplica).',
        },
      },
      required: ['id', 'estado'],
    },
  };

  constructor(
    private readonly leads: LeadsService,
    private readonly memory: LeadMemoryService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // Tolera que el modelo copie el id con corchetes: "[c1]".
    const id = String(input.id ?? '')
      .trim()
      .replace(/^\[|\]$/g, '');
    const estado = String(input.estado ?? '').trim() as EstadoFinal;
    if (!ESTADOS_FINALES.includes(estado)) {
      return {
        content: `Estado inválido "${estado}". Usa: ${ESTADOS_FINALES.join(', ')}.`,
        isError: true,
      };
    }
    const compromiso = await this.memory.resolveCommitment(
      ctx.lead.id,
      id,
      estado,
    );
    if (!compromiso) {
      return {
        content:
          `No hay ningún compromiso "${id}". Revisa los ids en la sección ` +
          'de compromisos.',
        isError: true,
      };
    }
    await programarProximoCompromiso(this.memory, this.leads, ctx.lead.id);
    return {
      content: `Compromiso [${compromiso.id}] "${compromiso.texto}" marcado como ${estado}.`,
    };
  }
}
