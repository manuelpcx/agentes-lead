import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { LeadsService, mergeLeadMetadata } from './leads.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { InteractionsService } from '../interactions/interactions.service';
import { CrmEventsService } from '../crm/crm-events.service';
import { IncomingLeadDto } from '../webhooks/dto/incoming-lead.dto';
import { TenantContext } from '../common/tenant/tenant-context';
import type { EnvVars } from '../common/config/env.validation';

/** Ejecuta la ingesta dentro de un contexto de tenant (como en producción). */
function ingestWithTenant(service: LeadsService, companyId = 'company-1') {
  return TenantContext.run({ companyId, correlationId: 'test-corr' }, () =>
    service.ingest(payload),
  );
}

const payload: IncomingLeadDto = {
  externalId: 'ext-1',
  name: 'Juan Pérez',
  source: 'landing-web',
  metadata: { utm_source: 'google' },
};

/** Construye el servicio con dobles de prueba y expone los mocks para asserts. */
function buildHarness() {
  const tx = {
    lead: {
      create: jest.fn().mockResolvedValue({ id: 'lead-nuevo' }),
      update: jest.fn().mockResolvedValue({ id: 'lead-existente' }),
      findFirst: jest.fn().mockResolvedValue({ metadata: {} }),
    },
    agent: {
      findFirst: jest.fn().mockResolvedValue({ followupConfig: {} }),
    },
  };

  const db = {
    lead: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  const prisma = { db } as unknown as PrismaService;
  const agents = {
    resolveDefaultAgentId: jest.fn().mockResolvedValue('agent-1'),
  } as unknown as AgentsService;
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  const crmEvents = {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as CrmEventsService;
  const config = {
    get: () => 0, // FOLLOWUP_FIRST_CONTACT_DELAY_MIN
  } as unknown as ConfigService<EnvVars, true>;

  const service = new LeadsService(
    prisma,
    agents,
    interactions,
    crmEvents,
    config,
  );
  return { service, db, tx, agents, interactions, crmEvents };
}

describe('LeadsService.ingest (idempotencia y trazabilidad)', () => {
  it('crea el lead en estado NUEVO la primera vez y registra interacción', async () => {
    const { service, db, tx, interactions } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce(null);

    const result = await ingestWithTenant(service);

    expect(result).toEqual({ leadId: 'lead-nuevo', created: true });
    expect(tx.lead.create).toHaveBeenCalledTimes(1);
    const createArg = (tx.lead.create as jest.Mock).mock.calls[0][0];
    expect(createArg.data.status).toBe('NUEVO');
    expect(createArg.data.agentId).toBe('agent-1');
    expect(createArg.data.externalId).toBe('ext-1');
    expect(interactions.register).toHaveBeenCalledTimes(1);
  });

  it('si el lead ya existe, actualiza y registra interacción SIN duplicar', async () => {
    const { service, db, tx, interactions } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lead-existente',
    });

    const result = await ingestWithTenant(service);

    expect(result).toEqual({ leadId: 'lead-existente', created: false });
    expect(tx.lead.update).toHaveBeenCalledTimes(1);
    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(interactions.register).toHaveBeenCalledTimes(1);
  });

  it('al actualizar, mezcla la metadata nueva con la existente (no la borra)', async () => {
    const { service, db, tx } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lead-existente',
    });
    // Metadata previa (ej. datos de cobranza) que NO viene en este payload.
    (tx.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      metadata: { folio: 'F-4821', monto: 150000 },
    });

    await ingestWithTenant(service);

    const updateArg = (tx.lead.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.metadata).toEqual({
      folio: 'F-4821',
      monto: 150000,
      utm_source: 'google', // del payload de este test
    });
  });

  it('ante una carrera (P2002) reintenta como actualización, no falla', async () => {
    const { service, db, tx } = buildHarness();
    (db.lead.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // primer chequeo: no existe
      .mockResolvedValueOnce({ id: 'lead-carrera' }); // tras la colisión: ya existe
    (tx.lead.create as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    const result = await ingestWithTenant(service);

    expect(result).toEqual({ leadId: 'lead-carrera', created: false });
    expect(tx.lead.update).toHaveBeenCalledTimes(1);
  });
});

describe('mergeLeadMetadata', () => {
  it('mezcla claves nuevas con las existentes', () => {
    expect(mergeLeadMetadata({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({
      a: 1,
      b: 3,
      c: 4,
    });
  });

  it('si lo existente no es un objeto plano, usa lo nuevo tal cual', () => {
    expect(mergeLeadMetadata(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeLeadMetadata(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(mergeLeadMetadata('texto', { a: 1 })).toEqual({ a: 1 });
    expect(mergeLeadMetadata([1, 2], { a: 1 })).toEqual({ a: 1 });
  });

  it('lo nuevo pisa lo viejo cuando comparten clave', () => {
    expect(mergeLeadMetadata({ estado: 'viejo' }, { estado: 'nuevo' })).toEqual(
      { estado: 'nuevo' },
    );
  });
});

describe('LeadsService: eventos hacia el CRM en cambios de estado', () => {
  function run<T>(fn: () => Promise<T>) {
    return TenantContext.run(
      { companyId: 'company-1', correlationId: 'x' },
      fn,
    );
  }

  it('updateStatus emite lead.status_changed con from/to cuando el estado cambia', async () => {
    const { service, db, crmEvents } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      status: 'NUEVO',
      externalId: 'ext-1',
    });
    (db.lead.update as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      status: 'AGENDADO',
      externalId: 'ext-1',
    });

    await run(() => service.updateStatus('lead-1', 'AGENDADO' as never));

    expect(crmEvents.emit).toHaveBeenCalledWith({
      leadId: 'lead-1',
      externalId: 'ext-1',
      event: 'lead.status_changed',
      data: { from: 'NUEVO', to: 'AGENDADO' },
    });
  });

  it('updateStatus NO emite si el estado no cambió', async () => {
    const { service, db, crmEvents } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      status: 'NUEVO',
      externalId: 'ext-1',
    });
    (db.lead.update as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      status: 'NUEVO',
      externalId: 'ext-1',
    });

    await run(() => service.updateStatus('lead-1', 'NUEVO' as never));

    expect(crmEvents.emit).not.toHaveBeenCalled();
  });

  it('escalateToHuman y closeAsLost también emiten lead.status_changed', async () => {
    const { service, db, crmEvents } = buildHarness();
    (db.lead.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        id: 'lead-1',
        status: 'NUEVO',
        externalId: 'e1',
      })
      .mockResolvedValueOnce({
        id: 'lead-1',
        status: 'NUEVO',
        externalId: 'e1',
      });
    (db.lead.update as jest.Mock)
      .mockResolvedValueOnce({
        id: 'lead-1',
        status: 'ESCALADO_HUMANO',
        externalId: 'e1',
      })
      .mockResolvedValueOnce({
        id: 'lead-1',
        status: 'CERRADO_PERDIDO',
        externalId: 'e1',
      });

    await run(() => service.escalateToHuman('lead-1'));
    await run(() => service.closeAsLost('lead-1'));

    expect(crmEvents.emit).toHaveBeenCalledTimes(2);
    expect(crmEvents.emit).toHaveBeenNthCalledWith(1, {
      leadId: 'lead-1',
      externalId: 'e1',
      event: 'lead.status_changed',
      data: { from: 'NUEVO', to: 'ESCALADO_HUMANO' },
    });
    expect(crmEvents.emit).toHaveBeenNthCalledWith(2, {
      leadId: 'lead-1',
      externalId: 'e1',
      event: 'lead.status_changed',
      data: { from: 'NUEVO', to: 'CERRADO_PERDIDO' },
    });
  });
});

describe('LeadsService.setQualification', () => {
  function run<T>(fn: () => Promise<T>) {
    return TenantContext.run(
      { companyId: 'company-1', correlationId: 'x' },
      fn,
    );
  }

  it('actualiza la calificación, el motivo y avisa al CRM', async () => {
    const { service, db, crmEvents } = buildHarness();
    (db.lead.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      externalId: 'ext-1',
    });
    (db.lead.update as jest.Mock).mockResolvedValueOnce({
      id: 'lead-1',
      externalId: 'ext-1',
      qualification: 'CALIENTE',
      qualificationReason: 'confirmó presupuesto y plazo',
    });

    await run(() =>
      service.setQualification(
        'lead-1',
        'CALIENTE' as never,
        'confirmó presupuesto y plazo',
      ),
    );

    expect(db.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({
          qualification: 'CALIENTE',
          qualificationReason: 'confirmó presupuesto y plazo',
          qualifiedAt: expect.any(Date),
        }),
      }),
    );
    expect(crmEvents.emit).toHaveBeenCalledWith({
      leadId: 'lead-1',
      externalId: 'ext-1',
      event: 'lead.qualified',
      data: {
        qualification: 'CALIENTE',
        reason: 'confirmó presupuesto y plazo',
      },
    });
  });
});
