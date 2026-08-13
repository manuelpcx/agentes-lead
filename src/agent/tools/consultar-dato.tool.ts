import { Injectable } from '@nestjs/common';
import { StructuredFactsService } from '../../knowledge/structured-facts.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_CONSULTAR_DATO } from './tool-names';

/**
 * Consulta la fuente de verdad (StructuredFact) por clave: precios, horarios,
 * políticas, servicios. Es la ÚNICA vía válida para dar cifras.
 */
@Injectable()
export class ConsultarDatoTool implements AgentTool {
  readonly name = TOOL_CONSULTAR_DATO;
  readonly definition = {
    name: this.name,
    description:
      'Consulta un dato operativo exacto y vigente por su clave (por ejemplo ' +
      '"precio_consulta_general", "horario_atencion"). Úsala SIEMPRE para ' +
      'precios, montos, horarios y políticas. Si no existe, no inventes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clave: {
          type: 'string',
          description:
            'La clave del dato (ej. precio_<servicio>, horario_atencion, ' +
            'politica_<nombre>).',
        },
      },
      required: ['clave'],
    },
  };

  constructor(private readonly facts: StructuredFactsService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const clave = String(input.clave ?? '').trim();
    if (!clave) {
      return { content: 'Falta el parámetro "clave".', isError: true };
    }

    const fact = await this.facts.getCurrent(clave);
    if (!fact) {
      return {
        content:
          `No hay dato vigente para la clave "${clave}". No inventes un ` +
          'valor: dilo al cliente y ofrece escalar a un humano.',
      };
    }

    const valor = JSON.stringify(fact.value);
    ctx.recordedFacts.push(`${clave} = ${valor}`);
    return { content: `Dato vigente: ${clave} = ${valor}` };
  }
}
