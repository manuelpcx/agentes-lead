import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { EmailService } from '../../email/email.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import {
  conditionSourcesFor,
  factSourcesFor,
  validateOutgoingMessage,
} from '../output-validator';
import { stripSystemAnnotation } from '../conversation-history';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ENVIAR_CORREO } from './tool-names';
import { collectionFloorRefusal, proactiveTag } from './collection-floor.guard';

/**
 * Envía un correo al lead. Aplica el mismo guardrail que WhatsApp: toda cifra
 * debe venir de un resultado de herramienta de este turno. Se revisan asunto
 * y cuerpo: un "30 % de descuento" en el asunto llega igual al cliente.
 */
@Injectable()
export class EnviarCorreoTool implements AgentTool {
  readonly name = TOOL_ENVIAR_CORREO;
  readonly definition = {
    name: this.name,
    description:
      'Envía un correo electrónico al lead (útil como canal alternativo o para ' +
      'enviar información más extensa). Toda cifra, porcentaje, número de ' +
      'cuotas o compromiso debe estar respaldado por un resultado de ' +
      'herramienta de este turno.',
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
    const cuerpo = stripSystemAnnotation(
      String(input.cuerpo ?? '').trim(),
    ).trim();
    if (!asunto || !cuerpo) {
      return { content: 'Faltan "asunto" o "cuerpo".', isError: true };
    }
    if (!ctx.lead.email) {
      return { content: 'El lead no tiene correo registrado.', isError: true };
    }

    const validation = validateOutgoingMessage(
      `${asunto}\n${cuerpo}`,
      factSourcesFor(ctx),
      conditionSourcesFor(ctx),
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

    // Piso legal de cobranza (topes y horario de gestiones proactivas).
    const limite = await collectionFloorRefusal(
      this.interactions,
      ctx,
      'mensajeria',
    );
    if (limite) {
      return { content: limite.content, isError: true, stop: limite.stop };
    }

    await this.email.send({
      to: ctx.lead.email,
      subject: asunto,
      text: cuerpo,
      // Para ubicar el lead si el correo rebota o lo marcan como spam.
      tags: { lead_id: ctx.lead.id },
    });
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.email,
      direction: Direction.outbound,
      content: `[${asunto}] ${cuerpo}`,
      agentId: ctx.agentId,
      metadata: proactiveTag(ctx),
    });
    ctx.messageSent = true;
    return { content: 'Correo enviado al lead.' };
  }
}
