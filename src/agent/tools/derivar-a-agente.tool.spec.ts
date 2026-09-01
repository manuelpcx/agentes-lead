import { DerivarAAgenteTool } from './derivar-a-agente.tool';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ToolContext } from './tool.interface';

function build() {
  const agentQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    db: {
      agent: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'ag-cob', name: 'Agente que cobra' }),
      },
    },
  };
  const leads = {
    reassignAgent: jest.fn().mockResolvedValue({}),
    scheduleNextAction: jest.fn().mockResolvedValue({}),
  };
  const interactions = { register: jest.fn().mockResolvedValue({}) };
  const whatsapp = { send: jest.fn().mockResolvedValue(undefined) };
  const tool = new DerivarAAgenteTool(
    agentQueue as never,
    prisma as never,
    leads as never,
    interactions as never,
    whatsapp as never,
  );
  return { tool, agentQueue, prisma, leads, interactions, whatsapp };
}

function ctxBase(followUp: boolean): ToolContext {
  return {
    lead: { id: 'lead-1', phone: '+56911111111' },
    agentId: 'ag-ventas',
    recordedFacts: [],
    followUp,
    escalated: false,
    messageSent: false,
  } as unknown as ToolContext;
}

function run(fn: () => Promise<unknown>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

describe('DerivarAAgenteTool', () => {
  it('turno proactivo (seguimiento): no avisa, no encola respuesta, programa primer contacto', async () => {
    const h = build();
    const ctx = ctxBase(true); // followUp
    await run(() =>
      h.tool.execute({ agente: 'Agente que cobra', resumen: 'r' }, ctx),
    );
    expect(h.leads.reassignAgent).toHaveBeenCalledWith('lead-1', 'ag-cob');
    expect(ctx.derived).toBe(true);
    expect(h.whatsapp.send).not.toHaveBeenCalled();
    expect(h.agentQueue.add).not.toHaveBeenCalled();
    expect(h.leads.scheduleNextAction).toHaveBeenCalledWith(
      'lead-1',
      expect.any(Date),
      'primer_contacto',
    );
  });

  it('respuesta en vivo: avisa al cliente y encola turno de respuesta', async () => {
    const h = build();
    const ctx = ctxBase(false); // respuesta a un mensaje del cliente
    await run(() =>
      h.tool.execute({ agente: 'Agente que cobra', resumen: 'r' }, ctx),
    );
    expect(ctx.derived).toBe(true);
    expect(h.whatsapp.send).toHaveBeenCalledTimes(1);
    expect(h.agentQueue.add).toHaveBeenCalledTimes(1);
    expect(h.leads.scheduleNextAction).not.toHaveBeenCalled();
  });
});
