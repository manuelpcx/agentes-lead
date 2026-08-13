import { ConflictException, BadRequestException } from '@nestjs/common';
import { AppointmentsService, ScheduleInput } from './appointments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { EmailService } from '../email/email.service';
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
    }),
    updateStatus: jest.fn().mockResolvedValue({}),
  } as unknown as LeadsService;

  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  const email = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;

  const service = new AppointmentsService(prisma, leads, interactions, email);
  return { service, prisma, leads, interactions, email };
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
