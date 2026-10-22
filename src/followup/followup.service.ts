import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentType,
  Channel,
  Direction,
  Lead,
  LeadStatus,
} from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { alinearConHoraHabitual, horaHabitual } from './preferred-hour';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AgentRunner } from '../agent/agent-runner.service';
import { VoiceService } from '../voice/voice.service';
import {
  PROMISE_PAY_TYPE,
  RECONTACT_TYPE,
  SCHEDULED_CALL_TYPE,
} from '../agent/agent.constants';
import { TIPO_DE_ACCION } from '../agent/tools/commitment-schedule';
import { LeadMemoryService } from '../memory/lead-memory.service';
import {
  Compromiso,
  TipoCompromiso,
  vencidoPendiente,
} from '../memory/commitments';
import {
  earliestAllowedTime,
  isLegalCollectionTime,
  isWithinBusinessHours,
  nextAllowedTime,
} from './business-hours';
import {
  COBRANZA_MIN_GAP_HOURS,
  GESTION_PROACTIVA,
  TipoGestion,
  collectionWindowStart,
  evaluateCollectionFloor,
} from './collection-floor';
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
/** Tipo de próxima acción cuando un tope legal de cobranza posterga el contacto. */
export const LEGAL_LIMIT_TYPE = 'limite_legal';
/** Espera antes de reintentar un seguimiento que falló todos sus reintentos. */
const RETRY_AFTER_FAILURE_MS = HOUR_MS;
/** Marca de los avisos de envío fallido en la conversación del lead. */
const FALLO_ENVIO = 'fallo_envio';

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
    private readonly memory: LeadMemoryService,
    @Optional() private readonly voice?: VoiceService,
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
      select: { followupConfig: true, type: true },
    });
    const eff = resolveEffectiveFollowup(
      parseAgentFollowupConfig(agentRow?.followupConfig),
      this.defaults,
    );
    // Cobranza: piso legal (Ley 19.496, art. 37) que la config del agente no
    // puede saltarse. Ver collection-floor.ts.
    const cobranza = agentRow?.type === AgentType.COBRANZA;

    // Llamada que el propio lead pidió agendar (vía el tool iniciarLlamada). No
    // pasa por el guard de "cliente habló último" ni por la escalera: es una
    // acción explícita, solo se respeta el horario hábil.
    const scheduledCall =
      lead.nextActionType === SCHEDULED_CALL_TYPE && !!lead.phone;
    // Verificación de una promesa de pago (cobranza): acción proactiva pactada.
    const promisePay = lead.nextActionType === PROMISE_PAY_TYPE;
    // La persona pidió que le escribieran en esta fecha (programarRecontacto).
    const recontacto = lead.nextActionType === RECONTACT_TYPE;

    // Compromiso pendiente que aún no llega: no se contacta antes de lo que la
    // persona pidió o prometió (insistir molesta, y en cobranza suma gestiones
    // contra el tope legal). Se corre el seguimiento a esa fecha.
    if (!scheduledCall && !promisePay && !recontacto) {
      const proximo = await this.memory.nextPendingCommitment(leadId);
      if (proximo) {
        await this.leads.scheduleNextAction(
          leadId,
          new Date(proximo.venceEn),
          TIPO_DE_ACCION[proximo.tipo],
        );
        this.logger.log(
          `Seguimiento en pausa hasta el compromiso ${proximo.id} ` +
            `(leadId=${leadId} → ${proximo.venceEn})`,
        );
        return;
      }
    }

    // Si el cliente fue el último en hablar, el flujo de respuesta (Fase 3) se
    // encarga; no perseguimos. Reprogramamos por si queda en silencio. (No aplica
    // a acciones proactivas pactadas: llamada agendada o verificar promesa.)
    if (!scheduledCall && !promisePay && !recontacto) {
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
    // En cobranza el horario legal se exige ADEMÁS del de la empresa: aunque
    // businessHours sea más amplio (o no esté configurado), no se sale de él.
    const horarioLegal = cobranza
      ? (d: Date) => isLegalCollectionTime(d, timezone)
      : undefined;
    const permitido = (d: Date) =>
      isWithinBusinessHours(company?.businessHours, timezone, d) &&
      (!horarioLegal || horarioLegal(d));
    if (!permitido(now)) {
      const next = nextAllowedTime(
        company?.businessHours,
        timezone,
        now,
        horarioLegal,
      );
      // Preserva el tipo si es una llamada agendada, para no perder la intención.
      await this.leads.scheduleNextAction(
        leadId,
        next,
        scheduledCall
          ? SCHEDULED_CALL_TYPE
          : promisePay
            ? PROMISE_PAY_TYPE
            : recontacto
              ? RECONTACT_TYPE
              : 'fuera_de_horario',
      );
      this.logger.log(
        `Seguimiento pospuesto por horario (leadId=${leadId} → ${next.toISOString()})`,
      );
      return;
    }

    // Verifica la promesa de pago: retoma con tacto para confirmar el pago.
    if (promisePay) {
      // Verificar la promesa es una gestión proactiva: respeta los topes.
      if (
        cobranza &&
        (await this.postponeForCollectionFloor(
          lead,
          'mensajeria',
          now,
          timezone,
          permitido,
          PROMISE_PAY_TYPE,
        ))
      ) {
        return;
      }
      const attempt = lead.contactAttempts + 1;
      const promesa = await this.compromisoVencido(leadId, 'pago');
      const instruction =
        '[VERIFICAR PROMESA DE PAGO] La persona se comprometió a pagar para esta ' +
        'fecha' +
        (promesa
          ? ` (lo acordado: "${promesa.texto}" para el ${promesa.fecha} [${promesa.id}])`
          : '') +
        '. Retoma con respeto y sin presionar para confirmar si pudo pagar. ' +
        'Si confirma que pagó, márcalo con actualizarCompromiso como cumplido. ' +
        'Si aún no, ofrece ayuda para regularizar y registra una nueva promesa ' +
        'con registrarPromesaPago si corresponde. Respalda cualquier cifra con el ' +
        'contexto de la deuda.';
      const outcome = await this.agent.runFollowUp(leadId, instruction);
      if (outcome.escalated || outcome.derived) {
        return; // escalado o derivado a otro agente: no contamos intento
      }
      await this.leads.recordFollowUpAttempt(
        leadId,
        this.nextActionTime(now, attempt, eff, cobranza),
        'seguimiento',
      );
      this.logger.log(`Verificación de promesa de pago (leadId=${leadId})`);
      return;
    }

    // Recontacto pactado: la persona pidió que le escribieran a esta hora.
    // Como lo pidió ella, no es una gestión proactiva: no cuenta para el tope
    // de 48 h de cobranza (igual que la llamada que agenda el lead). El
    // horario legal sí se exigió arriba.
    if (recontacto) {
      const attempt = lead.contactAttempts + 1;
      const pedido = await this.compromisoVencido(leadId, 'recontacto');

      // Si pasaron más de 24 h desde que escribió, WhatsApp no admite texto
      // libre: por correo si lo tiene; si no, con la plantilla de seguimiento.
      const ventanaAbierta = await this.isWhatsAppWindowOpen(leadId);
      if (!ventanaAbierta && !lead.email && lead.phone) {
        const template = pickTemplate(eff, 'followup');
        if (
          template &&
          (await this.sendWhatsAppTemplate(lead, template, company?.name))
        ) {
          if (pedido) {
            await this.memory.resolveCommitment(leadId, pedido.id, 'cumplido');
          }
          await this.leads.recordFollowUpAttempt(
            leadId,
            this.nextActionTime(now, attempt, eff, cobranza),
            'plantilla_wa',
          );
          this.logger.log(
            `Recontacto pactado por plantilla WhatsApp (leadId=${leadId})`,
          );
          return;
        }
      }
      const canal =
        !ventanaAbierta && lead.email
          ? ' Pasaron más de 24 h desde su último WhatsApp, así que no se le ' +
            'puede escribir texto libre por ahí: escríbele por correo con ' +
            'enviarCorreo.'
          : '';
      const instruction =
        '[RECONTACTO PACTADO] La persona pidió que le escribieras ahora' +
        (pedido ? ` para: "${pedido.texto}"` : '') +
        '. Escríbele: retoma desde ahí, como continuación de lo que ' +
        'conversaron (no como un primer contacto), y sin insistir si ya no ' +
        `le interesa.${canal} Respalda cualquier dato con tus herramientas.`;
      const outcome = await this.agent.runFollowUp(leadId, instruction, {
        requestedByLead: true,
      });
      if (outcome.escalated || outcome.derived) {
        return;
      }
      // Se cumplió lo pedido: escribirle ese día. Lo que siga es conversación.
      if (pedido && outcome.messageSent) {
        await this.memory.resolveCommitment(leadId, pedido.id, 'cumplido');
      }
      await this.leads.recordFollowUpAttempt(
        leadId,
        this.nextActionTime(now, attempt, eff, cobranza),
        'seguimiento',
      );
      this.logger.log(`Recontacto pactado ejecutado (leadId=${leadId})`);
      return;
    }

    // Ejecuta la llamada agendada: fuerza canal 'call' con instrucción explícita.
    if (scheduledCall) {
      const attempt = lead.contactAttempts + 1;
      const instruction =
        '[LLAMADA AGENDADA] El lead pidió que lo llamaras. Llámalo AHORA con la ' +
        'herramienta iniciarLlamada (sin volver a programar). Respalda cualquier ' +
        'dato con tus herramientas.';
      // La pidió el lead: no es una gestión proactiva (no cuenta para el tope
      // semanal de llamadas de cobranza; el horario legal sí se exigió arriba).
      const outcome = await this.agent.runFollowUp(leadId, instruction, {
        requestedByLead: true,
      });
      if (outcome.escalated || outcome.derived) {
        return; // escalado o derivado a otro agente: no contamos intento
      }
      await this.leads.recordFollowUpAttempt(
        leadId,
        this.nextActionTime(now, attempt, eff, cobranza),
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
    const nextTime = await this.alignToUsualHour(
      leadId,
      this.nextActionTime(now, attempt, eff, cobranza),
      now,
      timezone,
      permitido,
      cobranza,
    );

    // Escalera de canales: elige el canal de este intento según los datos de
    // contacto del lead (correo es el fiable para leads fríos).
    // Solo se pregunta por la voz si la escalera tiene llamadas.
    const canCall =
      eff.ladder.includes('call') && this.voice
        ? (await this.voice.availability()).canCall
        : true;
    let channel = resolveFollowUpChannel(attempt, eff.ladder, {
      hasEmail: !!lead.email,
      hasPhone: !!lead.phone,
      canCall,
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

    // Topes legales de cobranza: si este contacto los pasaría, se posterga sin
    // contar el intento (no hubo contacto).
    if (
      cobranza &&
      (await this.postponeForCollectionFloor(
        lead,
        channel === 'call' ? 'llamada' : 'mensajeria',
        now,
        timezone,
        permitido,
        LEGAL_LIMIT_TYPE,
      ))
    ) {
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
        if (await this.sendWhatsAppTemplate(lead, template, company?.name)) {
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
        channel = 'email'; // la plantilla falló y hay correo: sigue por ahí
      } else if (lead.email) {
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
      cobranza,
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

  /**
   * Plan por lead: si la persona suele responder a cierta hora, el próximo
   * seguimiento se corre hacia esa hora (hasta 12 h, dentro de lo permitido).
   * En cobranza solo se atrasa, para no achicar el espaciado legal.
   */
  private async alignToUsualHour(
    leadId: string,
    base: Date,
    now: Date,
    timezone: string,
    permitido: (d: Date) => boolean,
    cobranza: boolean,
  ): Promise<Date> {
    const respuestas = await this.prisma.db.interaction.findMany({
      where: {
        leadId,
        direction: Direction.inbound,
        channel: { in: CONVERSATION_CHANNELS },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { occurredAt: true },
    });
    const hora = horaHabitual(
      respuestas.map((r) => r.occurredAt),
      timezone,
    );
    if (hora === null) {
      return base;
    }
    return alinearConHoraHabitual(
      base,
      hora,
      timezone,
      now,
      permitido,
      12,
      cobranza,
    );
  }

  /**
   * Posterga un seguimiento que agotó sus reintentos (ej. el proveedor de
   * WhatsApp rechazó el envío por falta de saldo). Mantiene el tipo de la
   * próxima acción para no perder la intención (llamada agendada, promesa de
   * pago) y no cuenta intento: no hubo contacto. Solo actúa si la acción sigue
   * vencida, para no pisar algo que se haya agendado entretanto.
   */
  async deferAfterFailure(
    leadId: string,
    reason: string,
    now = new Date(),
  ): Promise<void> {
    const retryAt = new Date(now.getTime() + RETRY_AFTER_FAILURE_MS);
    const { count } = await this.prisma.db.lead.updateMany({
      where: { id: leadId, nextActionAt: { lte: now } },
      data: { nextActionAt: retryAt },
    });
    if (count === 0) {
      return;
    }
    this.logger.warn(
      `Seguimiento fallido, se reintenta más tarde (leadId=${leadId} → ${retryAt.toISOString()}): ${reason}`,
    );
    // Si el proveedor sigue caído esto se repite cada hora: el aviso basta
    // una vez al día para no llenar la conversación.
    await this.noteSendFailure(
      leadId,
      `Seguimiento automático fallido: ${reason}. Se vuelve a intentar en una hora.`,
      now,
    );
  }

  // ─────────────────────── privados ───────────────────────

  /** El compromiso de ese tipo que venció y sigue pendiente (el que se retoma). */
  private async compromisoVencido(
    leadId: string,
    tipo: TipoCompromiso,
  ): Promise<Compromiso | null> {
    const { commitments } = await this.memory.get(leadId);
    return vencidoPendiente(commitments.filter((c) => c.tipo === tipo));
  }

  /**
   * Reprograma según el espaciado explícito de la config efectiva para este
   * intento; si no está listado, cae al espaciado creciente `baseDelayHours *
   * intento`.
   */
  private nextActionTime(
    now: Date,
    attempt: number,
    eff: EffectiveFollowup,
    cobranza = false,
  ): Date {
    const configured =
      eff.delaysHours[attempt - 1] ?? eff.baseDelayHours * attempt;
    // En cobranza nunca menos de 48 h entre gestiones, diga lo que diga la
    // config del agente o la global.
    const delayHours = cobranza
      ? Math.max(configured, COBRANZA_MIN_GAP_HOURS)
      : configured;
    return new Date(now.getTime() + delayHours * HOUR_MS);
  }

  /**
   * Aplica los topes legales de cobranza a un contacto proactivo. Si no se
   * puede contactar ahora, reprograma para el primer momento que respete los
   * topes y el horario (legal y de la empresa) y devuelve true.
   */
  private async postponeForCollectionFloor(
    lead: Lead,
    kind: TipoGestion,
    now: Date,
    timezone: string,
    permitido: (d: Date) => boolean,
    nextActionType: string,
  ): Promise<boolean> {
    const contacts = await this.interactions.findProactiveSince(
      lead.id,
      collectionWindowStart(now, timezone),
    );
    const veredicto = evaluateCollectionFloor({
      kind,
      now,
      timezone,
      contacts,
      lastContactedAt: lead.lastContactedAt,
    });
    if (veredicto.allowed) {
      return false;
    }
    const when = earliestAllowedTime(veredicto.notBefore, permitido);
    await this.leads.scheduleNextAction(lead.id, when, nextActionType);
    this.logger.log(
      `Cobranza: contacto pospuesto por tope legal (leadId=${lead.id} ` +
        `${kind} → ${when.toISOString()}): ${veredicto.reason}`,
    );
    return true;
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
  ): Promise<boolean> {
    const firstName = lead.name?.trim().split(/\s+/)[0] || 'allí';
    try {
      await this.whatsapp.sendTemplate(lead.phone as string, {
        name: template.name,
        languageCode: template.language,
        bodyParams: [firstName, companyName?.trim() || 'nuestra empresa'],
      });
    } catch (error) {
      // Sin correo no hay alternativa: se propaga para que el procesador
      // reintente y, agotados los reintentos, postergue y avise.
      if (!lead.email) throw error;
      const reason = (error as Error).message;
      this.logger.warn(
        `Plantilla WhatsApp fallida, sigue por correo (leadId=${lead.id}): ${reason}`,
      );
      await this.noteSendFailure(lead.id, `${reason}. Se intenta por correo.`);
      return false;
    }
    await this.interactions.register({
      leadId: lead.id,
      channel: Channel.whatsapp,
      direction: Direction.outbound,
      content:
        `[plantilla ${template.name}] contacto proactivo ` +
        '(fuera de ventana de 24h)',
      agentId: null,
      metadata: { gestion: GESTION_PROACTIVA },
    });
    return true;
  }

  /**
   * Deja a la vista, en la conversación del lead, que un envío falló y por
   * qué. Sin esto el fallo solo quedaba en los logs del servidor y en el
   * panel parecía que el agente no había hecho nada. No repite el mismo aviso
   * dentro de 24 h.
   */
  private async noteSendFailure(
    leadId: string,
    content: string,
    now = new Date(),
  ): Promise<void> {
    const repetido = await this.prisma.db.interaction.findFirst({
      where: {
        leadId,
        channel: Channel.system,
        content,
        occurredAt: { gte: new Date(now.getTime() - 24 * HOUR_MS) },
      },
      select: { id: true },
    });
    if (repetido) return;
    await this.interactions.register({
      leadId,
      channel: Channel.system,
      direction: Direction.outbound,
      content,
      agentId: null,
      metadata: { tipo: FALLO_ENVIO },
    });
  }
}
