import { Injectable } from '@nestjs/common';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { normalizeImportance, normalizeKey } from '../../memory/lead-memory';
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
        importancia: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description:
            'Qué tan grave sería olvidarlo, de 1 a 10. 9-10: compromisos y ' +
            'restricciones (una promesa de pago, que no lo contacten por un ' +
            'canal, que no es el titular, quién decide). 6-8: datos del ' +
            'negocio (presupuesto, objeción, plazo, producto). 1-5: detalles ' +
            'útiles pero prescindibles. Cuando la memoria se llena, se olvida ' +
            'primero lo menos importante.',
        },
      },
      required: ['clave', 'valor', 'importancia'],
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

    const key = normalizeKey(clave);
    if (!key) {
      return {
        content: `La clave "${clave}" no es válida. Usa letras y números.`,
        isError: true,
      };
    }

    const facts = await this.memory.rememberFact(
      ctx.lead.id,
      clave,
      valor,
      normalizeImportance(input.importancia),
    );
    const guardado = facts.find((f) => f.clave === key);
    if (!guardado) {
      return {
        content:
          'No se guardó: la memoria de este lead está llena de datos más ' +
          'importantes que este. Sigue con la conversación.',
      };
    }
    return {
      content:
        `Guardado en la memoria del lead: ${guardado.clave} = ` +
        `${guardado.valor}. No lo repitas en este turno.`,
    };
  }
}
