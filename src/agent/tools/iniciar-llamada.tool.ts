import { Injectable } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { VoiceService } from '../../voice/voice.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  DEFAULT_VOICE_TONE,
  voiceConfigToOverrides,
} from '../../voice/voice-config';
import { SCHEDULED_CALL_TYPE } from '../agent.constants';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_INICIAR_LLAMADA } from './tool-names';

/**
 * Inicia una llamada de voz al lead (reservada para leads calientes o cuando el
 * lead lo pide). Con `programarEnMinutos` la agenda para más tarde en vez de
 * llamar ya. La transcripción llega luego por el webhook del proveedor de voz y
 * despierta al agente para retomar por texto.
 */
@Injectable()
export class IniciarLlamadaTool implements AgentTool {
  readonly name = TOOL_INICIAR_LLAMADA;
  readonly definition = {
    name: this.name,
    description:
      'Inicia una llamada de voz al lead. Úsala cuando el lead está caliente, ' +
      'pide que lo llamen, o el texto no avanza. Para una llamada MÁS TARDE ' +
      '(el lead pidió que lo llamen a cierta hora), pasa "programarEnMinutos" ' +
      'con los minutos de espera. La transcripción se registra al finalizar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        motivo: { type: 'string', description: 'Motivo de la llamada.' },
        programarEnMinutos: {
          type: 'number',
          description:
            'Opcional. Minutos de espera antes de llamar (para agendar la ' +
            'llamada más tarde). Omítelo o usa 0 para llamar de inmediato.',
        },
      },
      required: ['motivo'],
    },
  };

  constructor(
    private readonly voice: VoiceService,
    private readonly interactions: InteractionsService,
    private readonly leads: LeadsService,
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

    const minutos = Number(input.programarEnMinutos ?? 0);
    // Agendar para más tarde: el seguimiento la dispara a la hora indicada.
    if (Number.isFinite(minutos) && minutos > 0) {
      const cuando = new Date(Date.now() + minutos * 60_000);
      await this.leads.scheduleNextAction(
        ctx.lead.id,
        cuando,
        SCHEDULED_CALL_TYPE,
      );
      await this.interactions.register({
        leadId: ctx.lead.id,
        channel: Channel.system,
        direction: Direction.outbound,
        content: `Llamada agendada para ${cuando.toISOString()} (${motivo}).`,
        agentId: ctx.agentId,
      });
      return {
        content:
          `Llamada agendada en ~${Math.round(minutos)} min. Confírmaselo al ` +
          'lead por el canal de texto que corresponda.',
      };
    }

    // Llamada inmediata. Aplica la config de voz de la empresa (voz/tono/idioma/
    // velocidad/saludo) como overrides y variable dinámica de tono.
    const voiceCfg = ctx.companyVoice ?? {};
    const { callId } = await this.voice.startCall({
      to: ctx.lead.phone,
      metadata: {
        companyId: TenantContext.requireCompanyId(),
        leadId: ctx.lead.id,
        motivo,
      },
      dynamicVariables: {
        nombre: ctx.lead.name ?? 'cliente',
        empresa: ctx.companyName ?? 'la empresa',
        motivo,
        tono: voiceCfg.tone ?? DEFAULT_VOICE_TONE,
      },
      overrides: voiceConfigToOverrides(voiceCfg),
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
