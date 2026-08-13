import { Injectable } from '@nestjs/common';
import { SemanticSearchService } from '../../knowledge/semantic-search.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_BUSCAR_CONOCIMIENTO } from './tool-names';

/** Busca en la base de conocimiento (RAG) fragmentos relevantes a una consulta. */
@Injectable()
export class BuscarConocimientoTool implements AgentTool {
  readonly name = TOOL_BUSCAR_CONOCIMIENTO;
  readonly definition = {
    name: this.name,
    description:
      'Busca información general de la empresa (servicios, descripciones, ' +
      'FAQs, políticas) en la base de conocimiento. Úsala para responder ' +
      'preguntas abiertas. No devuelve precios exactos: para eso usa consultarDato.',
    input_schema: {
      type: 'object' as const,
      properties: {
        consulta: {
          type: 'string',
          description: 'La pregunta o tema a buscar, en lenguaje natural.',
        },
      },
      required: ['consulta'],
    },
  };

  constructor(private readonly search: SemanticSearchService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const consulta = String(input.consulta ?? '').trim();
    if (!consulta) {
      return { content: 'Falta el parámetro "consulta".', isError: true };
    }

    const results = await this.search.search(consulta, { minSimilarity: 0.1 });
    if (results.length === 0) {
      return {
        content:
          'Sin resultados en la base de conocimiento para esa consulta. ' +
          'No inventes: dilo al cliente y ofrece escalar a un humano.',
      };
    }

    const texto = results
      .map((r, i) => `[${i + 1}] (${r.documentTitle}) ${r.content}`)
      .join('\n\n');
    ctx.recordedFacts.push(texto);
    return { content: texto };
  }
}
