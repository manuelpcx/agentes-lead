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
import { AgentTool, ToolContext } from './tools/tool.interface';
import type { EnvVars } from '../common/config/env.validation';

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
  );

  return {
    runner,
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

    await h.runner.runTurn('lead-1');

    expect(h.createMessage).toHaveBeenCalledTimes(3);
    expect(h.consultar.execute).toHaveBeenCalledTimes(1);
    expect(h.enviar.execute).toHaveBeenCalledTimes(1);
  });

  it('corta el bucle cuando una herramienta pide stop (escalamiento)', async () => {
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(
      toolUse('escalarAHumano', { motivo: 'no tengo el dato' }),
    );
    // Si no cortara, pediría otra iteración; no la proveemos.

    await h.runner.runTurn('lead-1');

    expect(h.escalar.execute).toHaveBeenCalledTimes(1);
    // Solo una llamada al modelo: tras el stop no vuelve a iterar.
    expect(h.createMessage).toHaveBeenCalledTimes(1);
  });

  it('degrada a escalamiento cuando no hay LLM configurado', async () => {
    const h = buildHarness(false);

    await h.runner.runTurn('lead-1');

    expect(h.createMessage).not.toHaveBeenCalled();
    expect(h.leads.escalateToHuman).toHaveBeenCalledWith('lead-1');
    expect(h.whatsapp.send).toHaveBeenCalled();
  });

  it('no actúa si el lead está en control humano', async () => {
    const h = buildHarness();
    (h.leads.getById as jest.Mock).mockResolvedValueOnce({
      ...LEAD,
      isPausedForHuman: true,
    });

    await h.runner.runTurn('lead-1');

    expect(h.createMessage).not.toHaveBeenCalled();
  });
});
