import { Injectable } from '@nestjs/common';
import { LeadsService } from '../../leads/leads.service';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { calcularVencimiento } from '../../memory/commitments';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_PROGRAMAR_RECONTACTO } from './tool-names';
import { programarProximoCompromiso } from './commitment-schedule';

/**
 * Agenda volver a contactar a la persona en la fecha que ELLA pidió
 * ("escríbeme el lunes", "después del 15", "en marzo"). Queda como compromiso
 * en su memoria y, hasta esa fecha, el seguimiento automático no le escribe
 * por iniciativa propia: insistir antes de lo pedido molesta.
 */
@Injectable()
export class ProgramarRecontactoTool implements AgentTool {
  readonly name = TOOL_PROGRAMAR_RECONTACTO;
  readonly definition = {
    name: this.name,
    description:
      'Agenda volver a escribirle a la persona cuando ELLA lo pide: "escríbeme ' +
      'a las 10", "háblame mañana", "contáctame el lunes", "después del 15". ' +
      'Úsala SIEMPRE que lo pida: decirle "te escribo a las 10" sin agendarlo ' +
      'es prometer algo que nadie va a cumplir. Ese momento el sistema la ' +
      'retoma con el motivo (como lo pidió ella, no cuenta como insistencia); ' +
      'hasta entonces no se le escribe por iniciativa propia. Si pide una ' +
      'hora, pásala en "hora". No la uses para pagos (registrarPromesaPago) ' +
      'ni si pide que la LLAMEN (iniciarLlamada con la hora).',
    input_schema: {
      type: 'object' as const,
      properties: {
        fecha: {
          type: 'string',
          description:
            'Día en formato "YYYY-MM-DD" (usa la fecha actual del contexto ' +
            'para resolver "el lunes", "en marzo" → el primer día hábil, etc.).',
        },
        hora: {
          type: 'string',
          description:
            'Hora local "HH:MM" (24 h) si la pidió ("a las 10" → "10:00", ' +
            '"a las 4 de la tarde" → "16:00"). Sin hora, se retoma a las ' +
            '10:00 de ese día.',
        },
        motivo: {
          type: 'string',
          description:
            'Qué hay que retomar ese día, en una frase (ej. "ver si su socio ' +
            'aprobó el plan pro").',
        },
      },
      required: ['fecha', 'motivo'],
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
    const fecha = String(input.fecha ?? '').trim();
    const motivo = String(input.motivo ?? '').trim();
    if (!motivo) {
      return { content: 'Falta el "motivo" del recontacto.', isError: true };
    }
    const hora =
      input.hora != null && String(input.hora).trim()
        ? String(input.hora).trim()
        : undefined;
    const vence = calcularVencimiento(
      fecha,
      ctx.timezone ?? 'America/Santiago',
      new Date(),
      hora,
    );
    if ('error' in vence) {
      return { content: vence.error, isError: true };
    }

    const { compromiso, reemplazados } = await this.memory.addCommitment(
      ctx.lead.id,
      {
        tipo: 'recontacto',
        texto: motivo,
        fecha,
        venceEn: vence.venceEn,
        ...(hora ? { hora } : {}),
      },
    );
    await programarProximoCompromiso(this.memory, this.leads, ctx.lead.id);

    const anterior = reemplazados[0]
      ? ` Reemplaza al recontacto que había para el ${reemplazados[0].fecha}.`
      : '';
    return {
      content:
        `Recontacto agendado para ${fecha}${hora ? ` a las ${hora}` : ''} ` +
        `[${compromiso.id}]: ` +
        `"${compromiso.texto}". Hasta entonces no se le escribe por ` +
        `iniciativa propia.${anterior} Confírmale a la persona que le ` +
        'escribirás ese día.',
    };
  }
}
