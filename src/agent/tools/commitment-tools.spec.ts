import { Lead } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { CrmEventsService } from '../../crm/crm-events.service';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import {
  Compromiso,
  agregarCompromiso,
  proximoPendiente,
  resolverCompromiso,
} from '../../memory/commitments';
import { ToolContext } from './tool.interface';
import { RegistrarPromesaPagoTool } from './registrar-promesa-pago.tool';
import { ProgramarRecontactoTool } from './programar-recontacto.tool';
import { ActualizarCompromisoTool } from './actualizar-compromiso.tool';
import { programarProximoCompromiso } from './commitment-schedule';

/** Fecha futura fija: las herramientas rechazan fechas pasadas. */
const FUTURA = '2099-03-02';
const OTRA_FUTURA = '2099-03-09';

/** Memoria y casillero en memoria, con la misma lógica que producción. */
function buildHarness(
  slot: {
    nextActionAt?: Date | null;
    nextActionType?: string | null;
  } = {},
) {
  let compromisos: Compromiso[] = [];
  const lead = {
    id: 'lead-1',
    externalId: 'ext-1',
    nextActionAt: slot.nextActionAt ?? null,
    nextActionType: slot.nextActionType ?? null,
  };
  const memory = {
    addCommitment: jest.fn(
      async (_id: string, nuevo: Parameters<typeof agregarCompromiso>[1]) => {
        const r = agregarCompromiso(compromisos, nuevo);
        compromisos = r.lista;
        return r;
      },
    ),
    resolveCommitment: jest.fn(
      async (
        _id: string,
        id: string,
        estado: Parameters<typeof resolverCompromiso>[2],
      ) => {
        const r = resolverCompromiso(compromisos, id, estado);
        if (!r) return null;
        compromisos = r.lista;
        return r.compromiso;
      },
    ),
    nextPendingCommitment: jest.fn(async () => proximoPendiente(compromisos)),
  } as unknown as LeadMemoryService;
  const leads = {
    getById: jest.fn(async () => ({ ...lead })),
    scheduleNextAction: jest.fn(
      async (_id: string, cuando: Date, tipo: string) => {
        lead.nextActionAt = cuando;
        lead.nextActionType = tipo;
        return lead;
      },
    ),
  } as unknown as LeadsService;
  const interactions = {
    register: jest.fn(async () => ({})),
  } as unknown as InteractionsService;
  const crm = {
    emit: jest.fn(async () => undefined),
  } as unknown as CrmEventsService;
  const ctx = {
    lead: lead as unknown as Lead,
    agentId: 'agent-1',
    conversationId: 'conv-1',
    recordedFacts: [],
    timezone: 'America/Santiago',
    escalated: false,
    messageSent: false,
  } as ToolContext;

  return {
    promesa: new RegistrarPromesaPagoTool(leads, interactions, crm, memory),
    recontacto: new ProgramarRecontactoTool(leads, memory),
    actualizar: new ActualizarCompromisoTool(leads, memory),
    memory,
    leads,
    lead,
    ctx,
    compromisos: () => compromisos,
  };
}

describe('registrarPromesaPago', () => {
  it('guarda el compromiso y agenda la verificación a las 10:00 del lead', async () => {
    const h = buildHarness();

    const r = await h.promesa.execute(
      { fecha: FUTURA, monto: '150000' },
      h.ctx,
    );

    expect(r.isError).toBeUndefined();
    expect(r.content).toContain('[c1]');
    expect(h.compromisos()).toEqual([
      expect.objectContaining({ tipo: 'pago', texto: 'Pagar 150000' }),
    ]);
    // 10:00 en Santiago (UTC-3 en marzo) = 13:00 UTC; ya no medianoche UTC.
    expect(h.lead).toMatchObject({
      nextActionAt: new Date(`${FUTURA}T13:00:00.000Z`),
      nextActionType: 'promesa_pago',
    });
  });

  it('una promesa nueva reemplaza a la anterior y lo dice', async () => {
    const h = buildHarness();
    await h.promesa.execute({ fecha: FUTURA }, h.ctx);

    const r = await h.promesa.execute({ fecha: OTRA_FUTURA }, h.ctx);

    expect(r.content).toContain('Reemplaza a la promesa anterior');
    expect(h.compromisos().map((c) => c.estado)).toEqual([
      'cancelado',
      'pendiente',
    ]);
  });

  it('rechaza una fecha pasada', async () => {
    const h = buildHarness();

    const r = await h.promesa.execute({ fecha: '2020-01-01' }, h.ctx);

    expect(r.isError).toBe(true);
    expect(h.compromisos()).toEqual([]);
  });
});

describe('programarRecontacto', () => {
  it('agenda el recontacto con su motivo', async () => {
    const h = buildHarness();

    const r = await h.recontacto.execute(
      { fecha: FUTURA, motivo: 'ver si el socio aprobó' },
      h.ctx,
    );

    expect(r.content).toContain('Recontacto agendado');
    expect(h.lead.nextActionType).toBe('recontacto_pactado');
  });

  it('con hora, agenda a esa hora exacta en la zona del lead', async () => {
    const h = buildHarness();

    const r = await h.recontacto.execute(
      { fecha: FUTURA, hora: '16:30', motivo: 'ver la cuota' },
      h.ctx,
    );

    expect(r.content).toContain('a las 16:30');
    // 16:30 en Santiago (UTC-3 en marzo) = 19:30 UTC.
    expect(h.lead.nextActionAt).toEqual(new Date(`${FUTURA}T19:30:00.000Z`));
    expect(h.compromisos()[0]).toMatchObject({ hora: '16:30' });
  });

  it('rechaza una hora mal escrita', async () => {
    const h = buildHarness();

    const r = await h.recontacto.execute(
      { fecha: FUTURA, hora: '4pm', motivo: 'x' },
      h.ctx,
    );

    expect(r.isError).toBe(true);
  });

  it('exige el motivo', async () => {
    const h = buildHarness();

    const r = await h.recontacto.execute({ fecha: FUTURA }, h.ctx);

    expect(r.isError).toBe(true);
  });

  it('no pisa una llamada agendada que llega antes', async () => {
    const llamada = new Date('2099-02-01T15:00:00.000Z');
    const h = buildHarness({
      nextActionAt: llamada,
      nextActionType: 'llamada_programada',
    });

    await h.recontacto.execute({ fecha: FUTURA, motivo: 'x' }, h.ctx);

    expect(h.lead).toMatchObject({
      nextActionAt: llamada,
      nextActionType: 'llamada_programada',
    });
  });
});

describe('actualizarCompromiso', () => {
  it('marca el compromiso y, si no queda otro, el casillero vuelve a seguimiento común', async () => {
    const h = buildHarness();
    await h.promesa.execute({ fecha: FUTURA }, h.ctx);

    const r = await h.actualizar.execute(
      { id: '[c1]', estado: 'cumplido' },
      h.ctx,
    );

    expect(r.content).toContain('marcado como cumplido');
    // Sin esto, el seguimiento verificaría un pago ya confirmado.
    expect(h.lead.nextActionType).toBe('seguimiento');
  });

  it('si queda otro compromiso, el casillero pasa a ese', async () => {
    const h = buildHarness();
    await h.promesa.execute({ fecha: FUTURA }, h.ctx);
    await h.recontacto.execute({ fecha: OTRA_FUTURA, motivo: 'x' }, h.ctx);

    await h.actualizar.execute({ id: 'c1', estado: 'cumplido' }, h.ctx);

    expect(h.lead).toMatchObject({
      nextActionAt: new Date(`${OTRA_FUTURA}T13:00:00.000Z`),
      nextActionType: 'recontacto_pactado',
    });
  });

  it('rechaza un estado o un id que no existen', async () => {
    const h = buildHarness();

    expect(
      (await h.actualizar.execute({ id: 'c1', estado: 'pendiente' }, h.ctx))
        .isError,
    ).toBe(true);
    expect(
      (await h.actualizar.execute({ id: 'c9', estado: 'cumplido' }, h.ctx))
        .isError,
    ).toBe(true);
  });
});

describe('programarProximoCompromiso', () => {
  it('sin compromisos no toca un seguimiento común', async () => {
    const h = buildHarness({
      nextActionAt: new Date('2099-01-01T00:00:00Z'),
      nextActionType: 'seguimiento',
    });

    await programarProximoCompromiso(h.memory, h.leads, 'lead-1');

    expect(h.leads.scheduleNextAction).not.toHaveBeenCalled();
  });
});
