import { Injectable } from '@nestjs/common';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_GUARDAR_EN_MEMORIA } from './tool-names';

/**
 * Guarda un hecho en la memoria del lead: lo que hay que recordar de esa
 * persona cuando la conversación de hoy ya no esté en la ventana de mensajes.
 *
 * Es la contraparte explícita del resumen automático: el agente decide qué
 * merece recordarse en el momento en que lo aprende, que es cuando tiene el
 * contexto para juzgarlo.
 */
@Injectable()
export class GuardarEnMemoriaTool implements AgentTool {
  readonly name = TOOL_GUARDAR_EN_MEMORIA;
  readonly definition = {
    name: this.name,
    description:
      'Guarda en la memoria del lead un dato duradero que acabas de aprender ' +
      'de la persona: qué producto le interesa, una objeción, quién decide, ' +
      'cómo y cuándo prefiere que la contacten, su situación. Úsala cuando ' +
      'aparezca información que servirá dentro de semanas, NO para cosas del ' +
      'momento ni para repetir lo que ya está en tu contexto. Si la clave ya ' +
      'existe, se reemplaza con el valor nuevo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clave: {
          type: 'string',
          description:
            'Nombre corto del dato, en minúsculas y con guiones bajos ' +
            '(ej. "producto_de_interes", "objecion", "horario_preferido").',
        },
        valor: {
          type: 'string',
          description:
            'El dato en una frase breve, tal como lo dijo o lo dio a ' +
            'entender la persona.',
        },
      },
      required: ['clave', 'valor'],
    },
  };

  constructor(private readonly memory: LeadMemoryService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const clave = String(input.clave ?? '').trim();
    const valor = String(input.valor ?? '').trim();
    if (!clave || !valor) {
      return { content: 'Faltan "clave" o "valor".', isError: true };
    }

    const facts = await this.memory.rememberFact(ctx.lead.id, clave, valor);
    const guardado = facts[facts.length - 1];
    if (!guardado) {
      return {
        content: `La clave "${clave}" no es válida. Usa letras y números.`,
        isError: true,
      };
    }
    return {
      content:
        `Guardado en la memoria del lead: ${guardado.clave} = ` +
        `${guardado.valor}. No lo repitas en este turno.`,
    };
  }
}
