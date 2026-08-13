import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus, Channel, Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InteractionsService } from '../interactions/interactions.service';
import { appointmentReminder } from '../email/templates';

const WINDOW_MS = 24 * 60 * 60 * 1000; // recordar citas dentro de las próximas 24h

/**
 * Cron cada 15 min: envía recordatorios de las citas próximas (dentro de 24h)
 * que aún no se recordaron. Marca `reminderSentAt` para no duplicar.
 */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsappService,
    private readonly interactions: InteractionsService,
  ) {}

  @Cron('0 */15 * * * *')
  async sweep(): Promise<void> {
    const now = new Date();
    const upcoming = await this.prisma.raw.appointment.findMany({
      where: {
        reminderSentAt: null,
        startAt: { gte: now, lte: new Date(now.getTime() + WINDOW_MS) },
        status: {
          in: [AppointmentStatus.PROGRAMADA, AppointmentStatus.CONFIRMADA],
        },
      },
      include: {
        lead: {
          select: { name: true, phone: true, email: true, timezone: true },
        },
        company: { select: { name: true, timezone: true } },
      },
      take: 100,
    });

    for (const appt of upcoming) {
      try {
        await TenantContext.run(
          { companyId: appt.companyId, correlationId: appt.id },
          () => this.sendReminder(appt),
        );
      } catch (error) {
        this.logger.error(
          `Fallo al recordar cita ${appt.id}: ${(error as Error).message}`,
        );
      }
    }

    if (upcoming.length > 0) {
      this.logger.log(`Recordatorios enviados: ${upcoming.length}`);
    }
  }

  private async sendReminder(appt: {
    id: string;
    title: string;
    startAt: Date;
    leadId: string;
    location: string | null;
    lead: {
      name: string | null;
      phone: string | null;
      email: string | null;
      timezone: string | null;
    };
    company: { name: string; timezone: string };
  }): Promise<void> {
    const timezone =
      appt.lead.timezone ?? appt.company.timezone ?? 'America/Santiago';

    if (appt.lead.email) {
      await this.email.send(
        appointmentReminder({
          to: appt.lead.email,
          leadName: appt.lead.name,
          companyName: appt.company.name,
          title: appt.title,
          startAt: appt.startAt,
          location: appt.location,
          timezone,
        }),
      );
    }
    if (appt.lead.phone) {
      const cuando = this.fmt(appt.startAt, timezone);
      await this.whatsapp.send(
        appt.lead.phone,
        `Recordatorio: tu cita "${appt.title}" es el ${cuando}.`,
      );
    }

    await this.prisma.db.appointment.update({
      where: { id: appt.id },
      data: { reminderSentAt: new Date() },
    });
    await this.interactions.register({
      leadId: appt.leadId,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Recordatorio de cita enviado ("${appt.title}").`,
      agentId: null,
      metadata: { appointmentId: appt.id },
    });
  }

  private fmt(date: Date, timezone: string): string {
    try {
      return new Intl.DateTimeFormat('es-CL', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }
}
