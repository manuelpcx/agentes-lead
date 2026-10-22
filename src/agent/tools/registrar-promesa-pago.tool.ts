import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { CrmEventsService } from '../../crm/crm-events.service';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { calcularVencimiento } from '../../memory/commitments';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_REGISTRAR_PROMESA_PAGO } from './tool-names';
import { programarProximoCompromiso } from './commitment-schedule';

/**
 * Registra una promesa de pago del deudor (cobranza): deja constancia, la
 * guarda como compromiso en la memoria del lead y programa la verificación
 * para la fecha pactada (a las 10:00 en la zona del lead). Ese día el
 * seguimiento retoma el contacto (saltándose el guard de "cliente habló
 * último") para confirmar el pago. Una promesa nueva reemplaza a la anterior.
 */
@Injectable()
export class RegistrarPromesaPagoTool implements AgentTool {
  readonly name = TOOL_REGISTRAR_PROMESA_PAGO;
  readonly definition = {
    name: this.name,
    description:
      'Registra que el deudor se comprometió a pagar en una fecha. Úsalo cuando ' +
      'la persona da una fecha concreta de pago. El sistema hará el seguimiento ' +
      'ese día para verificar. Confirma la fecha con la persona antes de registrar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fecha: {
          type: 'string',
          description:
            'Fecha de pago prometida en formato "YYYY-MM-DD" (usa la fecha ' +
            'actual del contexto para resolver "el viernes", "el 15", etc.).',
        },
        monto: {
          type: 'string',
          description: 'Monto que promete pagar, si lo indica (opcional).',
        },
        nota: {
          type: 'string',
          description: 'Detalle breve del acuerdo (opcional).',
        },
      },
      required: ['fecha'],
    },
  };

  constructor(
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly crmEvents: CrmEventsService,
    private readonly memory: LeadMemoryService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const fecha = String(input.fecha ?? '').trim();
    const vence = calcularVencimiento(
      fecha,
      ctx.timezone ?? 'America/Santiago',
    );
    if ('error' in vence) {
      return { content: vence.error, isError: true };
    }
    const monto =
      input.monto != null && String(input.monto).trim()
        ? String(input.monto).trim()
        : '';
    const nota =
      input.nota != null && String(input.nota).trim()
        ? String(input.nota).trim()
        : '';

    const { compromiso, reemplazados } = await this.memory.addCommitment(
      ctx.lead.id,
      {
        tipo: 'pago',
        texto: `Pagar${monto ? ` ${monto}` : ''}${nota ? ` (${nota})` : ''}`,
        fecha,
        venceEn: vence.venceEn,
      },
    );
    await programarProximoCompromiso(this.memory, this.leads, ctx.lead.id);
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content:
        `Promesa de pago${monto ? ` por ${monto}` : ''} para ${fecha}` +
        `${nota ? ` — ${nota}` : ''}.`,
      agentId: ctx.agentId,
    });
    await this.crmEvents.emit({
      leadId: ctx.lead.id,
      externalId: ctx.lead.externalId,
      event: 'lead.promise_to_pay',
      data: { fecha, monto: monto || undefined, nota: nota || undefined },
    });
    const anterior = reemplazados[0]
      ? ` Reemplaza a la promesa anterior del ${reemplazados[0].fecha}, ` +
        `que quedó como ${reemplazados[0].estado}.`
      : '';
    return {
      content:
        `Promesa de pago registrada para ${fecha} [${compromiso.id}]. El ` +
        `sistema hará el seguimiento ese día.${anterior} Confírmale a la persona.`,
    };
  }
}
