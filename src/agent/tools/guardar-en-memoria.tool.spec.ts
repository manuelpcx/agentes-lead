import { Lead } from '@prisma/client';
import { GuardarEnMemoriaTool } from './guardar-en-memoria.tool';
import { ToolContext } from './tool.interface';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { MemoryFact, upsertFact } from '../../memory/lead-memory';

function buildHarness() {
  let facts: MemoryFact[] = [];
  const rememberFact = jest.fn(
    async (_leadId: string, clave: string, valor: string) => {
      facts = upsertFact(facts, clave, valor);
      return facts;
    },
  );
  const tool = new GuardarEnMemoriaTool({
    rememberFact,
  } as unknown as LeadMemoryService);

  const ctx: ToolContext = {
    lead: { id: 'lead-1' } as unknown as Lead,
    agentId: 'agent-1',
    conversationId: 'conv-1',
    recordedFacts: [],
    escalated: false,
    messageSent: false,
  };

  return { tool, ctx, rememberFact };
}

describe('GuardarEnMemoriaTool', () => {
  it('guarda el hecho y confirma lo que quedó', async () => {
    const { tool, ctx, rememberFact } = buildHarness();

    const result = await tool.execute(
      { clave: 'producto_de_interes', valor: 'plan pro' },
      ctx,
    );

    expect(rememberFact).toHaveBeenCalledWith(
      'lead-1',
      'producto_de_interes',
      'plan pro',
    );
    expect(result.content).toContain('producto_de_interes = plan pro');
    expect(result.isError).toBeUndefined();
  });

  it('normaliza la clave que escriba el modelo', async () => {
    const { tool, ctx } = buildHarness();

    const result = await tool.execute(
      { clave: 'Horario Preferido', valor: 'después de las 18' },
      ctx,
    );

    expect(result.content).toContain('horario_preferido');
  });

  it('pide los dos campos', async () => {
    const { tool, ctx, rememberFact } = buildHarness();

    const result = await tool.execute({ clave: 'solo_clave' }, ctx);

    expect(result.isError).toBe(true);
    expect(rememberFact).not.toHaveBeenCalled();
  });

  it('avisa si la clave no deja nada utilizable', async () => {
    const { tool, ctx } = buildHarness();

    const result = await tool.execute({ clave: '***', valor: 'algo' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('no es válida');
  });

  it('no marca el turno como resuelto: guardar no es responder', async () => {
    const { tool, ctx } = buildHarness();

    await tool.execute({ clave: 'a', valor: 'b' }, ctx);

    expect(ctx.messageSent).toBe(false);
    expect(ctx.escalated).toBe(false);
  });
});
