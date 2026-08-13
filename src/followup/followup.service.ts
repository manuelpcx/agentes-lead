import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Direction, LeadStatus } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentRunner } from '../agent/agent-runner.service';
import { isWithinBusinessHours, nextAllowedTime } from './business-hours';

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

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);
  private readonly maxAttempts: number;
  private readonly baseDelayHours: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly agent: AgentRunner,
  ) {
    this.maxAttempts = config.get('FOLLOWUP_MAX_ATTEMPTS', { infer: true });
    this.baseDelayHours = config.get('FOLLOWUP_BASE_DELAY_HOURS', {
      infer: true,
    });
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

    // Si el cliente fue el último en hablar, el flujo de respuesta (Fase 3) se
    // encarga; no perseguimos. Reprogramamos por si queda en silencio.
    const lastConv = await this.prisma.db.interaction.findFirst({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'desc' },
      select: { direction: true },
    });
    if (lastConv?.direction === Direction.inbound) {
      await this.leads.scheduleNextAction(
        leadId,
        new Date(Date.now() + this.baseDelayHours * HOUR_MS),
        'espera_respuesta',
      );
      return;
    }

    // Guarda de horario hábil + zona horaria.
    const company = await this.prisma.raw.company.findUnique({
      where: { id: TenantContext.requireCompanyId() },
      select: { businessHours: true, timezone: true },
    });
    const timezone = lead.timezone ?? company?.timezone ?? 'America/Santiago';
    const now = new Date();
    if (!isWithinBusinessHours(company?.businessHours, timezone, now)) {
      const next = nextAllowedTime(company?.businessHours, timezone, now);
      await this.leads.scheduleNextAction(leadId, next, 'fuera_de_horario');
      this.logger.log(
        `Seguimiento pospuesto por horario (leadId=${leadId} → ${next.toISOString()})`,
      );
      return;
    }

    // Tope de intentos → cerrar por falta de respuesta.
    if (lead.contactAttempts >= this.maxAttempts) {
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
    const instruction = primerContacto
      ? `[PRIMER CONTACTO] Este lead (origen: ${lead.source ?? 'desconocido'}) aún no ha conversado contigo. Preséntate breve y cálidamente por WhatsApp y ofrece ayuda para iniciar la conversación. No seas invasivo.`
      : `[SEGUIMIENTO ${attempt}/${this.maxAttempts}] El cliente no ha respondido a tu último mensaje. Envía por WhatsApp un mensaje de seguimiento breve para retomar el contacto. Si ya no tiene sentido insistir, no envíes nada (el sistema lo cerrará más adelante). Respalda cualquier dato con las herramientas.`;

    const outcome = await this.agent.runFollowUp(leadId, instruction);
    if (outcome.escalated) {
      return; // el lead quedó en control humano
    }

    // Cuenta el intento (asegura terminación) y reprograma con espaciado creciente.
    const delayHours = this.baseDelayHours * attempt;
    await this.leads.recordFollowUpAttempt(
      leadId,
      new Date(now.getTime() + delayHours * HOUR_MS),
      'seguimiento',
    );
    this.logger.log(
      `Seguimiento ejecutado (leadId=${leadId} intento=${attempt} ` +
        `enviado=${outcome.messageSent})`,
    );
  }
}
