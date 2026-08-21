import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { leadFactSources, validateOutgoingMessage } from '../output-validator';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_ENVIAR_WHATSAPP } from './tool-names';

/**
 * Envía un mensaje al cliente por WhatsApp. Antes de enviar, valida que toda
 * cifra provenga de un resultado de herramienta de este turno; si no, BLOQUEA
 * el mensaje, escala a un humano y corta el turno.
 */
@Injectable()
export class EnviarWhatsAppTool implements AgentTool {
  readonly name = TOOL_ENVIAR_WHATSAPP;
  readonly definition = {
    name: this.name,
    description:
      'Envía un mensaje de texto al cliente por WhatsApp. Es la única forma de ' +
      'comunicarte con el cliente. Toda cifra o compromiso debe estar ' +
      'respaldado por un resultado de consultarDato/buscarConocimiento de este turno.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mensaje: {
          type: 'string',
          description: 'El texto a enviar al cliente.',
        },
      },
      required: ['mensaje'],
    },
  };

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly interactions: InteractionsService,
    private readonly leads: LeadsService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const mensaje = String(input.mensaje ?? '').trim();
    if (!mensaje) {
      return { content: 'Falta el parámetro "mensaje".', isError: true };
    }

    const validation = validateOutgoingMessage(
      mensaje,
      leadFactSources(ctx.recordedFacts, ctx.lead),
    );
    if (!validation.allowed) {
      await this.leads.escalateToHuman(ctx.lead.id);
      await this.interactions.register({
        leadId: ctx.lead.id,
        channel: Channel.system,
        direction: Direction.outbound,
        content:
          `Mensaje BLOQUEADO por validación (cifras sin respaldo: ` +
          `${validation.offending.join(', ')}). Escalado a humano.`,
        agentId: null,
        metadata: { blockedMessage: mensaje, offending: validation.offending },
      });
      ctx.escalated = true;
      return {
        content:
          `BLOQUEADO: el mensaje contiene cifras sin respaldo ` +
          `(${validation.offending.join(', ')}). No se envió. El lead fue ` +
          'escalado a un humano. Termina el turno.',
        stop: true,
      };
    }

    if (!ctx.lead.phone) {
      return {
        content: 'El lead no tiene teléfono; no se puede enviar WhatsApp.',
        isError: true,
      };
    }

    await this.whatsapp.send(ctx.lead.phone, mensaje);
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.whatsapp,
      direction: Direction.outbound,
      content: mensaje,
      agentId: ctx.agentId,
    });
    ctx.messageSent = true;
    return { content: 'Mensaje enviado al cliente por WhatsApp.' };
  }
}
