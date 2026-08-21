import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { EmailService } from '../../email/email.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { leadFactSources, validateOutgoingMessage } from '../output-validator';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ENVIAR_CORREO } from './tool-names';

/**
 * Envía un correo al lead. Aplica el mismo guardrail que WhatsApp: toda cifra
 * debe venir de un resultado de herramienta de este turno.
 */
@Injectable()
export class EnviarCorreoTool implements AgentTool {
  readonly name = TOOL_ENVIAR_CORREO;
  readonly definition = {
    name: this.name,
    description:
      'Envía un correo electrónico al lead (útil como canal alternativo o para ' +
      'enviar información más extensa). Toda cifra o compromiso debe estar ' +
      'respaldado por un resultado de herramienta de este turno.',
    input_schema: {
      type: 'object' as const,
      properties: {
        asunto: { type: 'string', description: 'Asunto del correo.' },
        cuerpo: { type: 'string', description: 'Cuerpo del correo (texto).' },
      },
      required: ['asunto', 'cuerpo'],
    },
  };

  constructor(
    private readonly email: EmailService,
    private readonly interactions: InteractionsService,
    private readonly leads: LeadsService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const asunto = String(input.asunto ?? '').trim();
    const cuerpo = String(input.cuerpo ?? '').trim();
    if (!asunto || !cuerpo) {
      return { content: 'Faltan "asunto" o "cuerpo".', isError: true };
    }
    if (!ctx.lead.email) {
      return { content: 'El lead no tiene correo registrado.', isError: true };
    }

    const validation = validateOutgoingMessage(
      cuerpo,
      leadFactSources(ctx.recordedFacts, ctx.lead),
    );
    if (!validation.allowed) {
      await this.leads.escalateToHuman(ctx.lead.id);
      await this.interactions.register({
        leadId: ctx.lead.id,
        channel: Channel.system,
        direction: Direction.outbound,
        content: `Correo BLOQUEADO por validación (cifras sin respaldo: ${validation.offending.join(', ')}). Escalado a humano.`,
        agentId: null,
      });
      ctx.escalated = true;
      return {
        content: `BLOQUEADO: cifras sin respaldo (${validation.offending.join(', ')}). No se envió; escalado a humano. Termina el turno.`,
        stop: true,
      };
    }

    await this.email.send({
      to: ctx.lead.email,
      subject: asunto,
      text: cuerpo,
    });
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.email,
      direction: Direction.outbound,
      content: `[${asunto}] ${cuerpo}`,
      agentId: ctx.agentId,
    });
    ctx.messageSent = true;
    return { content: 'Correo enviado al lead.' };
  }
}
