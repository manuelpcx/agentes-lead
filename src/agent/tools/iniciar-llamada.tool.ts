import { Injectable } from '@nestjs/common';
import { AgentType, Channel, Direction } from '@prisma/client';
import { VoiceService } from '../../voice/voice.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  DEFAULT_VOICE_TONE,
  voiceConfigToOverrides,
} from '../../voice/voice-config';
import { SCHEDULED_CALL_TYPE } from '../agent.constants';
import {
  earliestAllowedTime,
  formatLocalDateTime,
  isLegalCollectionTime,
  nextLocalTime,
} from '../../followup/business-hours';
import {
  collectionFloorRefusal,
  isProactiveContact,
  proactiveTag,
} from './collection-floor.guard';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_INICIAR_LLAMADA } from './tool-names';

/** Ventana en la que una segunda llamada al mismo lead se considera duplicada. */
const RECENT_CALL_MS = 10 * 60 * 1000;

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

    let movidaPorLey = false;
    if (cuando && ctx.agentType === AgentType.COBRANZA) {
      // En cobranza, agendar una llamada por iniciativa propia saltaría el
      // tope semanal (la llamada agendada no cuenta como proactiva): solo se
      // agenda si el deudor lo pide en la conversación.
      if (isProactiveContact(ctx)) {
        return {
          content:
            'En un seguimiento de cobranza no se agendan llamadas por ' +
            'iniciativa propia: solo si el deudor lo pide. Usa el canal que ' +
            'indica la instrucción de seguimiento.',
          isError: true,
        };
      }
      // Y nunca fuera del horario legal: se corre al primer momento permitido.
      const legal = earliestAllowedTime(cuando, (d) =>
        isLegalCollectionTime(d, tz),
      );
      movidaPorLey = legal.getTime() !== cuando.getTime();
      cuando = legal;
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
      if (movidaPorLey) {
        return {
          content:
            'La hora pedida cae fuera del horario legal de cobranza (lunes a ' +
            'sábado de 8:00 a 20:00, sin festivos). La llamada quedó agendada ' +
            `para ${formatLocalDateTime(cuando, tz)}: díselo al deudor por el ` +
            'canal de texto que corresponda.',
        };
      }
      return {
        content:
          'Llamada agendada. Confírmaselo al lead por el canal de texto que ' +
          'corresponda (dile a qué hora lo llamarás).',
      };
    }

    // Guarda anti-duplicado: si ya se lanzó una llamada hace poco, no se lanza
    // otra. Sin esto, cada "llámame" del cliente arrancaba una llamada nueva
    // (dos llamadas reales, dos cobros, y el teléfono sonando dos veces).
    const reciente = await this.interactions.findRecent(
      ctx.lead.id,
      Channel.call,
      Direction.outbound,
      new Date(Date.now() - RECENT_CALL_MS),
    );
    if (reciente) {
      return {
        content:
          'Ya hay una llamada en curso o recién iniciada para este lead. ' +
          'No inicies otra: dile al cliente que el teléfono ya está sonando.',
        isError: true,
      };
    }

    // Piso legal de cobranza: horario legal y una llamada proactiva por semana.
    const limite = await collectionFloorRefusal(
      this.interactions,
      ctx,
      'llamada',
    );
    if (limite) {
      return { content: limite.content, isError: true, stop: limite.stop };
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
      metadata: { callId, ...proactiveTag(ctx) },
    });
    ctx.messageSent = true;
    return {
      content: `Llamada iniciada (callId ${callId}). La transcripción se registrará al finalizar.`,
    };
  }
}
