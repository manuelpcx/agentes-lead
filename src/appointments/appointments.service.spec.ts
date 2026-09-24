import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentsService, ScheduleInput } from './appointments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { EmailService } from '../email/email.service';
import { CrmEventsService } from '../crm/crm-events.service';
import { TenantContext } from '../common/tenant/tenant-context';

const BASE_INPUT: ScheduleInput = {
  leadId: 'lead-1',
  title: 'Consulta',
  startAt: new Date('2026-09-01T15:00:00Z'),
  endAt: new Date('2026-09-01T16:00:00Z'),
};

function buildHarness(
  opts: { overlap?: boolean; leadEmail?: string | null } = {},
) {
  const prisma = {
    db: {
      appointment: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.overlap ? { id: 'a-0', startAt: new Date() } : null,
          ),
        create: jest.fn().mockResolvedValue({
          id: 'appt-1',
          startAt: BASE_INPUT.startAt,
        }),
      },
    },
    raw: {
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Clinica', timezone: 'America/Santiago' }),
      },
    },
  } as unknown as PrismaService;

  const leads = {
    getById: jest.fn().mockResolvedValue({
      id: 'lead-1',
      name: 'Ana',
      email: opts.leadEmail === undefined ? 'ana@correo.cl' : opts.leadEmail,
      timezone: null,
      externalId: 'ext-1',
    }),
    updateStatus: jest.fn().mockResolvedValue({}),
  } as unknown as LeadsService;

  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  const email = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;
  const crmEvents = {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as CrmEventsService;

  const service = new AppointmentsService(
    prisma,
    leads,
    interactions,
    email,
    crmEvents,
  );
  return { service, prisma, leads, interactions, email, crmEvents };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'company-1', correlationId: 'c1' }, fn);
}

describe('AppointmentsService.schedule', () => {
  it('agenda cuando no hay conflicto y confirma por correo', async () => {
    const h = buildHarness();
    await run(() => h.service.schedule(BASE_INPUT));
    expect(h.prisma.db.appointment.create).toHaveBeenCalledTimes(1);
    expect(h.leads.updateStatus).toHaveBeenCalledWith('lead-1', 'AGENDADO');
    expect(h.email.send).toHaveBeenCalledTimes(1);
  });

  it('emite lead.appointment_scheduled al CRM con los datos de la cita', async () => {
    const h = buildHarness();
    await run(() => h.service.schedule(BASE_INPUT));
    expect(h.crmEvents.emit).toHaveBeenCalledWith({
      leadId: 'lead-1',
      externalId: 'ext-1',
      event: 'lead.appointment_scheduled',
      data: {
        title: 'Consulta',
        startAt: BASE_INPUT.startAt.toISOString(),
        endAt: BASE_INPUT.endAt.toISOString(),
        location: undefined,
      },
    });
  });

  it('rechaza si hay solape con otra cita', async () => {
    const h = buildHarness({ overlap: true });
    await expect(
      run(() => h.service.schedule(BASE_INPUT)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.prisma.db.appointment.create).not.toHaveBeenCalled();
  });

  it('rechaza si el fin no es posterior al inicio', async () => {
    const h = buildHarness();
    await expect(
      run(() =>
        h.service.schedule({ ...BASE_INPUT, endAt: BASE_INPUT.startAt }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no envía correo si el lead no tiene email', async () => {
    const h = buildHarness({ leadEmail: null });
    await run(() => h.service.schedule(BASE_INPUT));
    expect(h.email.send).not.toHaveBeenCalled();
  });
});

const EXISTING = {
  id: 'appt-1',
  leadId: 'lead-1',
  title: 'Consulta',
  startAt: new Date('2026-09-01T15:00:00Z'),
  endAt: new Date('2026-09-01T16:00:00Z'),
  status: 'PROGRAMADA',
  reminderSentAt: new Date('2026-08-31T15:00:00Z'),
};

/** Harness para `update`: findFirst devuelve la cita actual y luego el solape. */
function buildUpdateHarness(opts: { overlap?: boolean } = {}) {
  const h = buildHarness();
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(EXISTING)
    .mockResolvedValueOnce(
      opts.overlap ? { id: 'a-9', startAt: new Date() } : null,
    );
  const update = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      // Prisma trata `undefined` como "no tocar este campo"; el mock hace lo mismo.
      const changed = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      return Promise.resolve({ ...EXISTING, ...changed });
    });
  (h.prisma.db as unknown as Record<string, unknown>).appointment = {
    findFirst,
    update,
    findMany: jest.fn().mockResolvedValue([]),
  };
  return { ...h, findFirst, update };
}

describe('AppointmentsService.update', () => {
  it('reagenda, limpia el recordatorio ya enviado y avisa al CRM', async () => {
    const h = buildUpdateHarness();
    const startAt = new Date('2026-09-02T15:00:00Z');
    const endAt = new Date('2026-09-02T16:00:00Z');

    await run(() => h.service.update('appt-1', { startAt, endAt }, 'user-1'));

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startAt, endAt, reminderSentAt: null }),
      }),
    );
    expect(h.crmEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'lead.appointment_updated' }),
    );
    expect(h.interactions.register).toHaveBeenCalledTimes(1);
  });

  it('rechaza reagendar sobre otra cita que se solapa', async () => {
    const h = buildUpdateHarness({ overlap: true });
    await expect(
      run(() =>
        h.service.update('appt-1', {
          startAt: new Date('2026-09-02T15:00:00Z'),
          endAt: new Date('2026-09-02T16:00:00Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('cambiar solo el estado no toca el recordatorio ni verifica solapes', async () => {
    const h = buildUpdateHarness();
    await run(() =>
      h.service.update('appt-1', { status: AppointmentStatus.CANCELADA }),
    );
    const data = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe(AppointmentStatus.CANCELADA);
    expect(data).not.toHaveProperty('reminderSentAt');
    // Solo la lectura de la cita actual: sin segunda consulta de solape.
    expect(h.findFirst).toHaveBeenCalledTimes(1);
  });

  it('lanza NotFound si la cita no existe en la empresa', async () => {
    const h = buildUpdateHarness();
    h.findFirst.mockReset().mockResolvedValue(null);
    await expect(
      run(() => h.service.update('appt-1', { title: 'x' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no registra nada si el cambio no mueve horario ni estado', async () => {
    const h = buildUpdateHarness();
    await run(() => h.service.update('appt-1', { location: 'Sala 2' }));
    expect(h.interactions.register).not.toHaveBeenCalled();
    expect(h.crmEvents.emit).not.toHaveBeenCalled();
  });
});

describe('AppointmentsService.listInRange', () => {
  it('pide las citas que empiezan dentro del rango, con el lead', async () => {
    const h = buildUpdateHarness();
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');

    await run(() => h.service.listInRange(from, to));

    expect(h.prisma.db.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { startAt: { gte: from, lt: to } },
        include: { lead: { select: { id: true, name: true, phone: true } } },
      }),
    );
  });

  it('rechaza un rango invertido', async () => {
    const h = buildUpdateHarness();
    await expect(
      run(() =>
        h.service.listInRange(
          new Date('2026-10-01T00:00:00Z'),
          new Date('2026-09-01T00:00:00Z'),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
