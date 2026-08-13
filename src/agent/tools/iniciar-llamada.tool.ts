import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { VapiService } from '../../vapi/vapi.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_INICIAR_LLAMADA } from './tool-names';

/**
 * Inicia una llamada de voz al lead (reservado para leads calientes según la
 * escalera de canales). La transcripción llega luego por el webhook de Vapi.
 */
@Injectable()
export class IniciarLlamadaTool implements AgentTool {
  readonly name = TOOL_INICIAR_LLAMADA;
  readonly definition = {
    name: this.name,
    description:
      'Inicia una llamada de voz al lead. Úsala solo cuando el lead está caliente ' +
      'o el contacto por texto no avanza. La transcripción se registra al finalizar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        motivo: { type: 'string', description: 'Motivo de la llamada.' },
      },
      required: ['motivo'],
    },
  };

  constructor(
    private readonly vapi: VapiService,
    private readonly interactions: InteractionsService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const motivo = String(input.motivo ?? 'contacto').trim();
    if (!ctx.lead.phone) {
      return {
        content: 'El lead no tiene teléfono para llamar.',
        isError: true,
      };
    }

    const { callId } = await this.vapi.startCall({
      to: ctx.lead.phone,
      metadata: {
        companyId: TenantContext.requireCompanyId(),
        leadId: ctx.lead.id,
        motivo,
      },
    });
    await this.interactions.register({
      leadId: ctx.lead.id,
      channel: Channel.call,
      direction: Direction.outbound,
      content: `Llamada iniciada: ${motivo}`,
      agentId: ctx.agentId,
      metadata: { callId },
    });
    ctx.messageSent = true;
    return {
      content: `Llamada iniciada (callId ${callId}). La transcripción se registrará al finalizar.`,
    };
  }
}
