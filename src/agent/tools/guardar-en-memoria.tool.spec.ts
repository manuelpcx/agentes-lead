import { Lead } from '@prisma/client';
import { GuardarEnMemoriaTool } from './guardar-en-memoria.tool';
import { ToolContext } from './tool.interface';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { MAX_FACTS, MemoryFact, upsertFact } from '../../memory/lead-memory';

function buildHarness(iniciales: MemoryFact[] = []) {
  let facts: MemoryFact[] = iniciales;
  const rememberFact = jest.fn(
    async (
      _leadId: string,
      clave: string,
      valor: string,
      importancia?: number,
    ) => {
      facts = upsertFact(facts, clave, valor, importancia);
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

    // Sin importancia explícita, entra con la de por defecto.
    expect(rememberFact).toHaveBeenCalledWith(
      'lead-1',
      'producto_de_interes',
      'plan pro',
      5,
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

  it('guarda la importancia que decide el modelo', async () => {
    const { tool, ctx, rememberFact } = buildHarness();

    await tool.execute(
      { clave: 'pago', valor: 'prometió pagar el viernes', importancia: 9 },
      ctx,
    );

    expect(rememberFact).toHaveBeenCalledWith(
      'lead-1',
      'pago',
      'prometió pagar el viernes',
      9,
    );
  });

  it('avisa que no se guardó si la memoria está llena de datos más importantes', async () => {
    const llenos: MemoryFact[] = Array.from({ length: MAX_FACTS }, (_, i) => ({
      clave: `clave_${i}`,
      valor: `valor ${i}`,
      importancia: 9,
      registradoEn: new Date().toISOString(),
    }));
    const { tool, ctx } = buildHarness(llenos);

    const result = await tool.execute(
      { clave: 'color_favorito', valor: 'azul', importancia: 2 },
      ctx,
    );

    expect(result.content).not.toContain('Guardado en la memoria');
    expect(result.content).toMatch(/no se guard/i);
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
