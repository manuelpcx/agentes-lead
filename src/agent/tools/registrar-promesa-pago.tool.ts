import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { CrmEventsService } from '../../crm/crm-events.service';
import { PROMISE_PAY_TYPE } from '../agent.constants';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_REGISTRAR_PROMESA_PAGO } from './tool-names';

/**
 * Registra una promesa de pago del deudor (cobranza): deja constancia y
 * programa una verificación de seguimiento para la fecha pactada. Ese día el
 * seguimiento retoma el contacto (saltándose el guard de "cliente habló
 * último") para confirmar el pago.
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
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const fecha = String(input.fecha ?? '').trim();
    const cuando = new Date(fecha);
    if (!fecha || Number.isNaN(cuando.getTime())) {
      return {
        content: `Fecha inválida "${fecha}". Usa formato "YYYY-MM-DD".`,
        isError: true,
      };
    }
    const monto =
      input.monto != null && String(input.monto).trim()
        ? String(input.monto).trim()
        : '';
    const nota =
      input.nota != null && String(input.nota).trim()
        ? String(input.nota).trim()
        : '';

    await this.leads.scheduleNextAction(ctx.lead.id, cuando, PROMISE_PAY_TYPE);
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
    return {
      content: `Promesa de pago registrada para ${fecha}. El sistema hará el seguimiento ese día. Confírmale a la persona.`,
    };
  }
}
