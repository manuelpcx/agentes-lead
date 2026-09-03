import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Direction, Lead, LeadStatus } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AgentRunner } from '../agent/agent-runner.service';
import {
  PROMISE_PAY_TYPE,
  SCHEDULED_CALL_TYPE,
} from '../agent/agent.constants';
import { isWithinBusinessHours, nextAllowedTime } from './business-hours';
import {
  buildFollowUpInstruction,
  parseDelaysHours,
  parseLadder,
  resolveFollowUpChannel,
} from './channel-ladder';
import {
  AgentTemplateRef,
  EffectiveFollowup,
  FollowupDefaults,
  TemplatePurpose,
  parseAgentFollowupConfig,
  pickTemplate,
  resolveEffectiveFollowup,
} from '../agents/followup-config';

const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

/** Estados en los que ya no se hace seguimiento. */
const TERMINAL_STATUSES: LeadStatus[] = [
  LeadStatus.CERRADO_GANADO,
  LeadStatus.CERRADO_PERDIDO,
  LeadStatus.ESCALADO_HUMANO,
];

const HOUR_MS = 60 * 60 * 1000;
/** Ventana de servicio de WhatsApp para mensajes de texto libre. */
const WHATSAPP_WINDOW_MS = 24 * HOUR_MS;

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);
  /** Defaults globales (de env); fallback de lo que el agente no configure. */
  private readonly defaults: FollowupDefaults;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly whatsapp: WhatsappService,
    private readonly agent: AgentRunner,
  ) {
    this.defaults = {
      ladder: parseLadder(
        config.get('FOLLOWUP_CHANNEL_LADDER', { infer: true }),
      ),
      delaysHours: parseDelaysHours(
        config.get('FOLLOWUP_DELAYS_HOURS', { infer: true }),
      ),
      baseDelayHours: config.get('FOLLOWUP_BASE_DELAY_HOURS', { infer: true }),
      maxAttempts: config.get('FOLLOWUP_MAX_ATTEMPTS', { infer: true }),
      template: {
        name: config.get('FOLLOWUP_WHATSAPP_TEMPLATE', { infer: true }).trim(),
        language: config.get('FOLLOWUP_WHATSAPP_TEMPLATE_LANG', {
          infer: true,
        }),
      },
    };
  }

  /**
   * Procesa el seguimiento de un lead: aplica guardas (control humano, estados
   * terminales, horario hábil), decide primer-contacto vs seguimiento, corre al
   * agente y reprograma o cierra.
   */
  async processFollowUp(leadId: string): Promise<void> {
    const lead = await this.leads.getById(leadId);

    if (lead.isPausedForHuman || TERMINAL_STATUSES.includes(lead.status)) {
      return;
    }

    // Config de seguimiento efectiva: la del agente a cargo sobre los defaults.
    const agentRow = await this.prisma.db.agent.findFirst({
      where: { id: lead.agentId },
      select: { followupConfig: true },
    });
    const eff = resolveEffectiveFollowup(
      parseAgentFollowupConfig(agentRow?.followupConfig),
      this.defaults,
    );

    // Llamada que el propio lead pidió agendar (vía el tool iniciarLlamada). No
    // pasa por el guard de "cliente habló último" ni por la escalera: es una
    // acción explícita, solo se respeta el horario hábil.
    const scheduledCall =
      lead.nextActionType === SCHEDULED_CALL_TYPE && !!lead.phone;
    // Verificación de una promesa de pago (cobranza): acción proactiva pactada.
    const promisePay = lead.nextActionType === PROMISE_PAY_TYPE;

    // Si el cliente fue el último en hablar, el flujo de respuesta (Fase 3) se
    // encarga; no perseguimos. Reprogramamos por si queda en silencio. (No aplica
    // a acciones proactivas pactadas: llamada agendada o verificar promesa.)
    if (!scheduledCall && !promisePay) {
      const lastConv = await this.prisma.db.interaction.findFirst({
        where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
        orderBy: { occurredAt: 'desc' },
        select: { direction: true },
      });
      if (lastConv?.direction === Direction.inbound) {
        await this.leads.scheduleNextAction(
          leadId,
          new Date(Date.now() + eff.baseDelayHours * HOUR_MS),
          'espera_respuesta',
        );
        return;
      }
    }

    // Guarda de horario hábil + zona horaria (y nombre para la plantilla).
    const company = await this.prisma.raw.company.findUnique({
      where: { id: TenantContext.requireCompanyId() },
      select: { name: true, businessHours: true, timezone: true },
    });
    const timezone = lead.timezone ?? company?.timezone ?? 'America/Santiago';
    const now = new Date();
    if (!isWithinBusinessHours(company?.businessHours, timezone, now)) {
      const next = nextAllowedTime(company?.businessHours, timezone, now);
      // Preserva el tipo si es una llamada agendada, para no perder la intención.
      await this.leads.scheduleNextAction(
        leadId,
        next,
        scheduledCall
          ? SCHEDULED_CALL_TYPE
          : promisePay
            ? PROMISE_PAY_TYPE
            : 'fuera_de_horario',
      );
      this.logger.log(
        `Seguimiento pospuesto por horario (leadId=${leadId} → ${next.toISOString()})`,
      );
      return;
    }

    // Verifica la promesa de pago: retoma con tacto para confirmar el pago.
    if (promisePay) {
      const attempt = lead.contactAttempts + 1;
      const instruction =
        '[VERIFICAR PROMESA DE PAGO] La persona se comprometió a pagar para esta ' +
        'fecha. Retoma con respeto y sin presionar para confirmar si pudo pagar. ' +
        'Si aún no, ofrece ayuda para regularizar y registra una nueva promesa ' +
        'con registrarPromesaPago si corresponde. Respalda cualquier cifra con el ' +
        'contexto de la deuda.';
      const outcome = await this.agent.runFollowUp(leadId, instruction);
      if (outcome.escalated || outcome.derived) {
        return; // escalado o derivado a otro agente: no contamos intento
      }
      await this.leads.recordFollowUpAttempt(
        leadId,
        this.nextActionTime(now, attempt, eff),
        'seguimiento',
      );
      this.logger.log(`Verificación de promesa de pago (leadId=${leadId})`);
      return;
    }

    // Ejecuta la llamada agendada: fuerza canal 'call' con instrucción explícita.
    if (scheduledCall) {
      const attempt = lead.contactAttempts + 1;
      const instruction =
        '[LLAMADA AGENDADA] El lead pidió que lo llamaras. Llámalo AHORA con la ' +
        'herramienta iniciarLlamada (sin volver a programar). Respalda cualquier ' +
        'dato con tus herramientas.';
      const outcome = await this.agent.runFollowUp(leadId, instruction);
      if (outcome.escalated || outcome.derived) {
        return; // escalado o derivado a otro agente: no contamos intento
      }
      await this.leads.recordFollowUpAttempt(
        leadId,
        this.nextActionTime(now, attempt, eff),
        'seguimiento',
      );
      this.logger.log(`Llamada agendada ejecutada (leadId=${leadId})`);
      return;
    }

    // Tope de intentos → cerrar por falta de respuesta.
    if (lead.contactAttempts >= eff.maxAttempts) {
      await this.leads.closeAsLost(leadId);
      await this.interactions.register({
        leadId,
        channel: Channel.system,
        direction: Direction.outbound,
        content: `Cerrado por falta de respuesta tras ${lead.contactAttempts} intentos.`,
        agentId: null,
      });
      this.logger.log(`Lead cerrado por no-respuesta (leadId=${leadId})`);
      return;
    }

    const primerContacto = lead.contactAttempts === 0;
    const attempt = lead.contactAttempts + 1;
    const nextTime = this.nextActionTime(now, attempt, eff);

    // Escalera de canales: elige el canal de este intento según los datos de
    // contacto del lead (correo es el fiable para leads fríos).
    let channel = resolveFollowUpChannel(attempt, eff.ladder, {
      hasEmail: !!lead.email,
      hasPhone: !!lead.phone,
    });
    if (!channel) {
      await this.leads.closeAsLost(leadId);
      await this.interactions.register({
        leadId,
        channel: Channel.system,
        direction: Direction.outbound,
        content:
          'Cerrado: el lead no tiene teléfono ni correo para contactarlo.',
        agentId: null,
      });
      this.logger.log(`Lead cerrado por inalcanzable (leadId=${leadId})`);
      return;
    }

    // Ventana de 24h de WhatsApp: el texto libre del agente SOLO se puede enviar
    // si el cliente escribió por WhatsApp en las últimas 24h. Si está cerrada:
    //  - con plantilla configurada → envío determinista de plantilla (HSM), la
    //    del propósito de este momento (apertura/seguimiento/reactivación).
    //  - sin plantilla → cae a correo; si tampoco hay correo, cuenta el intento.
    if (channel === 'whatsapp' && !(await this.isWhatsAppWindowOpen(leadId))) {
      const purpose: TemplatePurpose = primerContacto
        ? 'opening'
        : attempt >= eff.maxAttempts
          ? 'reactivation'
          : 'followup';
      const template = pickTemplate(eff, purpose);
      if (template && lead.phone) {
        await this.sendWhatsAppTemplate(lead, template, company?.name);
        await this.leads.recordFollowUpAttempt(
          leadId,
          nextTime,
          'plantilla_wa',
        );
        this.logger.log(
          `Seguimiento por plantilla WhatsApp (leadId=${leadId} intento=${attempt} ` +
            `propósito=${purpose} plantilla=${template.name})`,
        );
        return;
      }
      if (lead.email) {
        channel = 'email'; // fallback: fuera de ventana y sin plantilla
      } else {
        await this.leads.recordFollowUpAttempt(
          leadId,
          nextTime,
          'wa_fuera_de_ventana',
        );
        this.logger.warn(
          `WhatsApp fuera de ventana y sin plantilla ni correo ` +
            `(leadId=${leadId} intento=${attempt})`,
        );
        return;
      }
    }

    const instruction = buildFollowUpInstruction({
      channel,
      attempt,
      maxAttempts: eff.maxAttempts,
      primerContacto,
      source: lead.source,
    });

    const outcome = await this.agent.runFollowUp(leadId, instruction);
    if (outcome.escalated || outcome.derived) {
      return; // escalado o derivado a otro agente: no contamos intento
    }

    // Cuenta el intento (asegura terminación) y reprograma.
    await this.leads.recordFollowUpAttempt(leadId, nextTime, 'seguimiento');
    this.logger.log(
      `Seguimiento ejecutado (leadId=${leadId} intento=${attempt} ` +
        `canal=${channel} enviado=${outcome.messageSent})`,
    );
  }

  // ─────────────────────── privados ───────────────────────

  /**
   * Reprograma según el espaciado explícito de la config efectiva para este
   * intento; si no está listado, cae al espaciado creciente `baseDelayHours *
   * intento`.
   */
  private nextActionTime(
    now: Date,
    attempt: number,
    eff: EffectiveFollowup,
  ): Date {
    const delayHours =
      eff.delaysHours[attempt - 1] ?? eff.baseDelayHours * attempt;
    return new Date(now.getTime() + delayHours * HOUR_MS);
  }

  /** La ventana de 24h está abierta si hubo un WhatsApp entrante hace < 24h. */
  private async isWhatsAppWindowOpen(leadId: string): Promise<boolean> {
    const lastInbound = await this.prisma.db.interaction.findFirst({
      where: {
        leadId,
        channel: Channel.whatsapp,
        direction: Direction.inbound,
      },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (!lastInbound) {
      return false;
    }
    return Date.now() - lastInbound.occurredAt.getTime() < WHATSAPP_WINDOW_MS;
  }

  /**
   * Envía la plantilla del propósito correspondiente (contacto proactivo fuera
   * de ventana). La plantilla espera 2 variables de cuerpo: {{1}} = nombre del
   * lead, {{2}} = nombre de la empresa (el tenant).
   */
  private async sendWhatsAppTemplate(
    lead: Lead,
    template: AgentTemplateRef,
    companyName?: string | null,
  ): Promise<void> {
    const firstName = lead.name?.trim().split(/\s+/)[0] || 'allí';
    await this.whatsapp.sendTemplate(lead.phone as string, {
      name: template.name,
      languageCode: template.language,
      bodyParams: [firstName, companyName?.trim() || 'nuestra empresa'],
    });
    await this.interactions.register({
      leadId: lead.id,
      channel: Channel.whatsapp,
      direction: Direction.outbound,
      content:
        `[plantilla ${template.name}] contacto proactivo ` +
        '(fuera de ventana de 24h)',
      agentId: null,
    });
  }
}
