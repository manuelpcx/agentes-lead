import { Prisma } from '@prisma/client';
import { LeadsService } from './leads.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { InteractionsService } from '../interactions/interactions.service';
import { IncomingLeadDto } from '../webhooks/dto/incoming-lead.dto';
import { TenantContext } from '../common/tenant/tenant-context';

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
    },
  };

  const db = {
    lead: { findFirst: jest.fn() },
    $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  const prisma = { db } as unknown as PrismaService;
  const agents = {
    resolveDefaultAgentId: jest.fn().mockResolvedValue('agent-1'),
  } as unknown as AgentsService;
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;

  const service = new LeadsService(prisma, agents, interactions);
  return { service, db, tx, agents, interactions };
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
