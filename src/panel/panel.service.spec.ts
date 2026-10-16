import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadQualification, LeadStatus } from '@prisma/client';
import { PanelService } from './panel.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { TenantContext } from '../common/tenant/tenant-context';

const LEAD = {
  id: 'lead-1',
  externalId: 'ext-1',
  name: 'Ana',
  phone: '+56911111111',
  email: 'ana@correo.cl',
  status: LeadStatus.NUEVO,
  qualification: null,
};

function buildHarness() {
  const prisma = {
    db: {
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(LEAD),
      },
      interaction: { findMany: jest.fn().mockResolvedValue([]) },
      leadNote: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'note-1', leadId: 'lead-1', body: 'ojo' }),
        create: jest.fn().mockResolvedValue({ id: 'note-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
    },
    raw: { user: { findMany: jest.fn().mockResolvedValue([]) } },
  } as unknown as PrismaService;

  const leads = {
    getById: jest.fn().mockResolvedValue(LEAD),
    ingest: jest.fn().mockResolvedValue({ leadId: 'lead-1', created: true }),
    updateStatus: jest.fn().mockResolvedValue(LEAD),
    setQualification: jest.fn().mockResolvedValue(LEAD),
  } as unknown as LeadsService;

  const memory = {
    get: jest.fn().mockResolvedValue({
      summary: null,
      facts: [],
      updatedAt: null,
    }),
    setSummary: jest.fn().mockResolvedValue(undefined),
    rememberFact: jest.fn().mockResolvedValue([]),
    forgetFact: jest.fn().mockResolvedValue([]),
  } as unknown as LeadMemoryService;

  const service = new PanelService(
    prisma,
    leads,
    { register: jest.fn() } as unknown as InteractionsService,
    {
      listForLead: jest.fn().mockResolvedValue([]),
    } as unknown as AgentActionsService,
    {
      listForLead: jest.fn().mockResolvedValue([]),
    } as unknown as AppointmentsService,
    { send: jest.fn() } as unknown as WhatsappService,
    {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService,
    memory,
  );
  return { service, prisma, leads, memory };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'company-1', correlationId: 'c1' }, fn);
}

describe('PanelService.listLeads (buscador del CRM)', () => {
  it('busca el término en nombre, teléfono, email e identificador de origen', async () => {
    const h = buildHarness();
    await run(() => h.service.listLeads({ q: '  Ana ' }));

    const where = (h.prisma.db.lead.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where.OR).toEqual([
      { name: { contains: 'Ana', mode: 'insensitive' } },
      { phone: { contains: 'Ana' } },
      { email: { contains: 'Ana', mode: 'insensitive' } },
      { externalId: { contains: 'Ana', mode: 'insensitive' } },
    ]);
  });

  it('combina estado y búsqueda', async () => {
    const h = buildHarness();
    await run(() =>
      h.service.listLeads({ status: LeadStatus.AGENDADO, q: '+5699' }),
    );
    const where = (h.prisma.db.lead.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where.status).toBe(LeadStatus.AGENDADO);
    expect(where.OR).toHaveLength(4);
  });

  it('sin término no arma filtro de texto', async () => {
    const h = buildHarness();
    await run(() => h.service.listLeads({ q: '   ' }));
    const where = (h.prisma.db.lead.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where.OR).toBeUndefined();
  });
});

describe('PanelService.createLead', () => {
  it('exige teléfono o email', async () => {
    const h = buildHarness();
    await expect(
      run(() => h.service.createLead({ name: 'Ana' }, 'user-1')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.leads.ingest).not.toHaveBeenCalled();
  });

  it('reutiliza el ingest del webhook con un externalId propio del panel', async () => {
    const h = buildHarness();
    await run(() =>
      h.service.createLead({ name: 'Ana', phone: '+56911111111' }, 'user-1'),
    );

    const payload = (h.leads.ingest as jest.Mock).mock.calls[0][0];
    expect(payload.externalId).toMatch(/^panel-/);
    expect(payload.source).toBe('panel');
    expect(payload.phone).toBe('+56911111111');
  });
});

describe('PanelService.updateLead', () => {
  it('encauza el cambio de estado por LeadsService (para que el CRM se entere)', async () => {
    const h = buildHarness();
    await run(() =>
      h.service.updateLead('lead-1', { status: LeadStatus.AGENDADO }, 'user-1'),
    );
    expect(h.leads.updateStatus).toHaveBeenCalledWith(
      'lead-1',
      LeadStatus.AGENDADO,
    );
  });

  it('califica con un motivo por defecto cuando el humano no escribe uno', async () => {
    const h = buildHarness();
    await run(() =>
      h.service.updateLead(
        'lead-1',
        { qualification: LeadQualification.CALIENTE },
        'user-1',
      ),
    );
    expect(h.leads.setQualification).toHaveBeenCalledWith(
      'lead-1',
      LeadQualification.CALIENTE,
      expect.stringContaining('manualmente'),
    );
  });

  it('limpia la próxima acción cuando llega nextActionAt en null', async () => {
    const h = buildHarness();
    await run(() =>
      h.service.updateLead('lead-1', { nextActionAt: null }, 'user-1'),
    );
    const data = (h.prisma.db.lead.update as jest.Mock).mock.calls[0][0].data;
    expect(data.nextActionAt).toBeNull();
  });

  it('no escribe si no vienen campos directos', async () => {
    const h = buildHarness();
    await run(() => h.service.updateLead('lead-1', {}, 'user-1'));
    expect(h.prisma.db.lead.update).not.toHaveBeenCalled();
  });
});

describe('PanelService notas', () => {
  it('valida que el lead sea del tenant antes de crear la nota', async () => {
    const h = buildHarness();
    await run(() => h.service.addNote('lead-1', 'Llamar el lunes', 'user-1'));
    expect(h.leads.getById).toHaveBeenCalledWith('lead-1');
    expect(h.prisma.db.leadNote.create).toHaveBeenCalled();
  });

  it('lanza NotFound al borrar una nota de otra empresa', async () => {
    const h = buildHarness();
    (h.prisma.db.leadNote.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      run(() => h.service.deleteNote('note-9', 'user-1')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.db.leadNote.delete).not.toHaveBeenCalled();
  });
});

describe('PanelService memoria', () => {
  it('un dato que agrega una persona del equipo entra con importancia alta', async () => {
    // Lo corrigió alguien a propósito: no puede desplazarlo lo que el agente
    // anote después.
    const h = buildHarness();
    await run(() =>
      h.service.updateMemory(
        'lead-1',
        { clave: 'decide', valor: 'el socio, Pedro' },
        'user-1',
      ),
    );
    expect(h.memory.rememberFact).toHaveBeenCalledWith(
      'lead-1',
      'decide',
      'el socio, Pedro',
      8,
    );
  });
});
