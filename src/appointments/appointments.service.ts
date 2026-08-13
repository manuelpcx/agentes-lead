import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  Channel,
  Direction,
  LeadStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { EmailService } from '../email/email.service';
import { appointmentConfirmation } from '../email/templates';

/** Datos para agendar una cita. */
export interface ScheduleInput {
  leadId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  location?: string;
  notes?: string;
  agentId?: string;
  createdBy?: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Agenda una cita verificando que no se solape con otra vigente de la
   * empresa. Al crear: mueve el lead a AGENDADO, registra la interacción y
   * envía confirmación por correo si el lead tiene email.
   */
  async schedule(input: ScheduleInput): Promise<Appointment> {
    if (input.endAt <= input.startAt) {
      throw new BadRequestException(
        'La hora de fin debe ser posterior al inicio',
      );
    }

    // Verificación de conflictos: solape con citas no canceladas de la empresa.
    const overlap = await this.prisma.db.appointment.findFirst({
      where: {
        status: { not: AppointmentStatus.CANCELADA },
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
      select: { id: true, startAt: true },
    });
    if (overlap) {
      throw new ConflictException(
        `Ya existe una cita que se solapa con ese horario (${overlap.startAt.toISOString()})`,
      );
    }

    const lead = await this.leads.getById(input.leadId);
    const appointment = await this.prisma.db.appointment.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        leadId: input.leadId,
        agentId: input.agentId ?? null,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location,
        notes: input.notes,
        status: AppointmentStatus.PROGRAMADA,
        createdBy: input.createdBy,
      },
    });

    await this.leads.updateStatus(input.leadId, LeadStatus.AGENDADO);
    await this.interactions.register({
      leadId: input.leadId,
      channel: Channel.system,
      direction: Direction.outbound,
      content: `Cita agendada: "${input.title}" para ${input.startAt.toISOString()}`,
      agentId: input.agentId ?? null,
      metadata: { appointmentId: appointment.id },
    });

    if (lead.email) {
      const company = await this.prisma.raw.company.findUnique({
        where: { id: TenantContext.requireCompanyId() },
        select: { name: true, timezone: true },
      });
      await this.email.send(
        appointmentConfirmation({
          to: lead.email,
          leadName: lead.name,
          companyName: company?.name ?? 'nuestro equipo',
          title: input.title,
          startAt: input.startAt,
          location: input.location,
          timezone: lead.timezone ?? company?.timezone ?? 'America/Santiago',
        }),
      );
    }

    this.logger.log(
      `Cita agendada (appointmentId=${appointment.id} leadId=${input.leadId})`,
    );
    return appointment;
  }

  /** Lista las citas de un lead (para el panel / contexto). */
  async listForLead(leadId: string): Promise<Appointment[]> {
    return this.prisma.db.appointment.findMany({
      where: { leadId },
      orderBy: { startAt: 'asc' },
    });
  }
}
