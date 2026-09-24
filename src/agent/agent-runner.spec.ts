import { ConfigService } from '@nestjs/config';
import { AgentRunner } from './agent-runner.service';
import { AnthropicService } from '../llm/anthropic.service';
import { ContextBuilder } from './context-builder.service';
import { ToolRegistry } from './tools/tool-registry.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InteractionsService } from '../interactions/interactions.service';
import { LeadsService } from '../leads/leads.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AgentTool, ToolContext } from './tools/tool.interface';
import { factSourcesFor, validateOutgoingMessage } from './output-validator';
import type { EnvVars } from '../common/config/env.validation';
import type { Queue } from 'bullmq';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { LeadMemoryJobData } from '../memory/lead-memory.processor';

/** Corre `fn` dentro de un contexto de tenant (como el processor de la cola). */
function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run(
    { companyId: 'company-1', correlationId: 'test' },
    fn,
  );
}

const LEAD = {
  id: 'lead-1',
  agentId: 'agent-1',
  isPausedForHuman: false,
  phone: '+56911111111',
  status: 'NUEVO',
  name: 'Ana',
  source: 'landing',
};

/** Bloque tool_use simulado del modelo. */
function toolUse(name: string, input: Record<string, unknown>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `tu-${name}`, name, input }],
  };
}

function endTurn() {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'listo' }],
  };
}

function buildHarness(configured = true) {
  const config = {
    get: (key: string) =>
      key === 'AGENT_MAX_ITERATIONS'
        ? 6
        : key === 'AGENT_TIMEOUT_MS'
          ? 60000
          : undefined,
  } as unknown as ConfigService<EnvVars, true>;

  const createMessage = jest.fn();
  const anthropic = {
    isConfigured: () => configured,
    createMessage,
  } as unknown as AnthropicService;

  const prisma = {
    db: {
      agent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'agent-1',
          enabledTools: [],
          type: 'VENTAS',
        }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
        create: jest.fn(),
      },
    },
    raw: {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          channelsConfig: { whatsapp: { phoneNumber: '+56911112222' } },
        }),
      },
    },
  } as unknown as PrismaService;

  const contextBuilder = {
    buildSystem: jest.fn().mockResolvedValue('system'),
    buildMessages: jest
      .fn()
      .mockResolvedValue([{ role: 'user', content: '¿cuánto cuesta?' }]),
  } as unknown as ContextBuilder;

  // Tools falsos con la misma interfaz.
  const consultar: AgentTool = {
    name: 'consultarDato',
    definition: {
      name: 'consultarDato',
      description: '',
      input_schema: { type: 'object' as const },
    },
    execute: jest.fn(async (_input, ctx: ToolContext) => {
      ctx.recordedFacts.push('precio = {"monto":25000}');
      return { content: 'dato' };
    }),
  };
  const enviar: AgentTool = {
    name: 'enviarWhatsApp',
    definition: {
      name: 'enviarWhatsApp',
      description: '',
      input_schema: { type: 'object' as const },
    },
    execute: jest.fn(async (_input, ctx: ToolContext) => {
      ctx.messageSent = true;
      return { content: 'enviado' };
    }),
  };
  const escalar: AgentTool = {
    name: 'escalarAHumano',
    definition: {
      name: 'escalarAHumano',
      description: '',
      input_schema: { type: 'object' as const },
    },
    execute: jest.fn(async (_input, ctx: ToolContext) => {
      ctx.escalated = true;
      return { content: 'escalado', stop: true };
    }),
  };

  const toolRegistry = {
    forAgent: jest.fn(() => [consultar, enviar, escalar]),
  } as unknown as ToolRegistry;

  const whatsapp = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as WhatsappService;
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  const leads = {
    getById: jest.fn().mockResolvedValue(LEAD),
    escalateToHuman: jest.fn().mockResolvedValue(LEAD),
  } as unknown as LeadsService;
  const agentActions = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentActionsService;

  // La memoria no se refresca en estos tests: `needsRefresh` devuelve false.
  const memory = {
    needsRefresh: jest.fn().mockResolvedValue(false),
  } as unknown as LeadMemoryService;
  const memoryQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue<LeadMemoryJobData>;

  const runner = new AgentRunner(
    config,
    prisma,
    anthropic,
    contextBuilder,
    toolRegistry,
    whatsapp,
    interactions,
    leads,
    agentActions,
    memory,
    memoryQueue,
  );

  return {
    runner,
    memory,
    memoryQueue,
    contextBuilder,
    createMessage,
    consultar,
    enviar,
    escalar,
    whatsapp,
    leads,
    interactions,
  };
}

describe('AgentRunner.runTurn', () => {
  it('ejecuta el bucle: consulta un dato, envía por WhatsApp y termina', async () => {
    const h = buildHarness();
    h.createMessage
      .mockResolvedValueOnce(toolUse('consultarDato', { clave: 'precio' }))
      .mockResolvedValueOnce(
        toolUse('enviarWhatsApp', { mensaje: 'cuesta 25000' }),
      )
      .mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.createMessage).toHaveBeenCalledTimes(3);
    expect(h.consultar.execute).toHaveBeenCalledTimes(1);
    expect(h.enviar.execute).toHaveBeenCalledTimes(1);

    // Mientras no se ha enviado nada, se fuerza el uso de alguna tool (evita
    // que el modelo se quede con el dato de consultarDato y no lo relaye).
    // Una vez enviado el WhatsApp, el turno puede cerrar en 'auto'.
    expect(h.createMessage.mock.calls[0][0].toolChoice).toEqual({
      type: 'any',
    });
    expect(h.createMessage.mock.calls[1][0].toolChoice).toEqual({
      type: 'any',
    });
    expect(h.createMessage.mock.calls[2][0].toolChoice).toBeUndefined();
  });

  it('corta el bucle cuando una herramienta pide stop (escalamiento)', async () => {
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(
      toolUse('escalarAHumano', { motivo: 'no tengo el dato' }),
    );
    // Si no cortara, pediría otra iteración; no la proveemos.

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.escalar.execute).toHaveBeenCalledTimes(1);
    // Solo una llamada al modelo: tras el stop no vuelve a iterar.
    expect(h.createMessage).toHaveBeenCalledTimes(1);
  });

  it('degrada a escalamiento cuando no hay LLM configurado', async () => {
    const h = buildHarness(false);

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.leads.escalateToHuman).toHaveBeenCalledWith('lead-1');
    expect(h.whatsapp.send).toHaveBeenCalled();
  });

  it('escala y avisa al cliente si el modelo responde en texto suelto sin usar ninguna herramienta', async () => {
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.leads.escalateToHuman).toHaveBeenCalledWith('lead-1');
    expect(h.whatsapp.send).toHaveBeenCalledWith(
      '+56911111111',
      expect.any(String),
    );
  });

  it('no aplica el respaldo de silencio en turnos de seguimiento proactivo', async () => {
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(endTurn());

    const outcome = await inTenant(() =>
      h.runner.runFollowUp('lead-1', 'reintenta el contacto'),
    );

    expect(h.leads.escalateToHuman).not.toHaveBeenCalled();
    expect(h.whatsapp.send).not.toHaveBeenCalled();
    expect(outcome.messageSent).toBe(false);
    expect(outcome.escalated).toBe(false);
  });

  it('no actúa si el lead está en control humano', async () => {
    const h = buildHarness();
    (h.leads.getById as jest.Mock).mockResolvedValueOnce({
      ...LEAD,
      isPausedForHuman: true,
    });

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.createMessage).not.toHaveBeenCalled();
  });
});

describe('AgentRunner y la memoria del lead', () => {
  it('no encola nada si todavía no toca refrescar', async () => {
    const h = buildHarness();
    h.createMessage
      .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
      .mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.memoryQueue.add).not.toHaveBeenCalled();
  });

  it('encola el refresco cuando se acumularon mensajes nuevos', async () => {
    const h = buildHarness();
    (h.memory.needsRefresh as jest.Mock).mockResolvedValue(true);
    h.createMessage
      .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
      .mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.memoryQueue.add).toHaveBeenCalledWith(
      'refresh',
      expect.objectContaining({ leadId: 'lead-1', companyId: 'company-1' }),
      expect.objectContaining({ jobId: 'memory-lead-1' }),
    );
  });

  it('un fallo al encolar no hace fallar el turno', async () => {
    const h = buildHarness();
    (h.memory.needsRefresh as jest.Mock).mockRejectedValue(
      new Error('Redis caído'),
    );
    h.createMessage
      .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
      .mockResolvedValueOnce(endTurn());

    await expect(
      inTenant(() => h.runner.runTurn('lead-1')),
    ).resolves.toBeUndefined();
  });
});

describe('AgentRunner y el respaldo del guardrail', () => {
  it('el resultado de una herramienta respalda el mensaje del mismo turno', async () => {
    const h = buildHarness();
    let respaldos: string[] = [];
    (h.enviar.execute as jest.Mock).mockImplementation(
      async (_input: unknown, ctx: ToolContext) => {
        respaldos = factSourcesFor(ctx);
        ctx.messageSent = true;
        return { content: 'enviado' };
      },
    );
    h.createMessage
      .mockResolvedValueOnce(toolUse('consultarDato', { clave: 'precio' }))
      .mockResolvedValueOnce(
        toolUse('enviarWhatsApp', { mensaje: 'son 25000' }),
      )
      .mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(respaldos).toContain('dato');
    expect(validateOutgoingMessage('son 25000', respaldos).allowed).toBe(true);
  });

  it('lo que escribió el cliente también respalda', async () => {
    const h = buildHarness();
    let respaldos: string[] = [];
    (h.enviar.execute as jest.Mock).mockImplementation(
      async (_input: unknown, ctx: ToolContext) => {
        respaldos = factSourcesFor(ctx);
        ctx.messageSent = true;
        return { content: 'enviado' };
      },
    );
    (h.contextBuilder.buildMessages as jest.Mock).mockResolvedValue([
      { role: 'user', content: 'mi pedido es el 458812' },
    ]);
    h.createMessage
      .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'x' }))
      .mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(
      validateOutgoingMessage('Reviso el pedido 458812', respaldos).allowed,
    ).toBe(true);
  });
});
