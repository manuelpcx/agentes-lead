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
import { nextLocalTime } from '../../followup/business-hours';
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
      'pide que lo llamen, o el texto no avanza. Para agendar la llamada a una ' +
      'HORA concreta que pidió el lead (ej. "a las 16"), pasa "programarParaHora" ' +
      'en formato 24h "HH:MM" (el sistema calcula la espera en la zona horaria ' +
      'correcta; si la hora ya pasó hoy, será mañana). Como alternativa, ' +
      '"programarEnMinutos" agenda en N minutos. Sin ninguno de los dos, llama ' +
      'de inmediato. La transcripción se registra al finalizar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        motivo: { type: 'string', description: 'Motivo de la llamada.' },
        programarParaHora: {
          type: 'string',
          description:
            'Opcional. Hora local a la que llamar, formato 24h "HH:MM" ' +
            '(ej. "16:00"). Úsalo cuando el lead pide una hora específica.',
        },
        programarEnMinutos: {
          type: 'number',
          description:
            'Opcional. Minutos de espera antes de llamar. Omítelo o usa 0 para ' +
            'llamar de inmediato. Si defines "programarParaHora", ignora esto.',
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

    // Agendar para más tarde: por hora absoluta (preferido) o por minutos.
    // El servidor calcula la hora exacta en la zona horaria del lead/empresa,
    // así el modelo no tiene que hacer aritmética de tiempo.
    const tz = ctx.timezone ?? 'America/Santiago';
    const horaAbs =
      typeof input.programarParaHora === 'string'
        ? input.programarParaHora.trim()
        : '';
    const minutos = Number(input.programarEnMinutos ?? 0);
    let cuando: Date | null = null;
    if (horaAbs) {
      cuando = nextLocalTime(new Date(), tz, horaAbs);
      if (!cuando) {
        return {
          content: `Hora inválida "${horaAbs}". Usa formato 24h "HH:MM".`,
          isError: true,
        };
      }
    } else if (Number.isFinite(minutos) && minutos > 0) {
      cuando = new Date(Date.now() + minutos * 60_000);
    }

    if (cuando) {
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
          'Llamada agendada. Confírmaselo al lead por el canal de texto que ' +
          'corresponda (dile a qué hora lo llamarás).',
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
