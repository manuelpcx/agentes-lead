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
import { VoiceService } from '../voice/voice.service';
import { FALLBACK_ESCALATION_MESSAGE } from './agent.constants';

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

function buildHarness(
  configured = true,
  opts: {
    voice?: VoiceService;
    extraTools?: AgentTool[];
    toolChoice?: 'any' | 'auto';
  } = {},
) {
  const config = {
    get: (key: string) =>
      key === 'AGENT_MAX_ITERATIONS'
        ? 6
        : key === 'AGENT_TIMEOUT_MS'
          ? 60000
          : key === 'ANTHROPIC_TOOL_CHOICE'
            ? opts.toolChoice
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
    forAgent: jest.fn(() => [
      consultar,
      enviar,
      escalar,
      ...(opts.extraTools ?? []),
    ]),
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
    opts.voice,
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

  /** `stop_reason: tool_use` sin ningún bloque de herramienta. */
  function toolUseSinHerramientas() {
    return {
      stop_reason: 'tool_use',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
    };
  }

  it('nunca le manda a la API un mensaje de usuario vacío', async () => {
    // Caso real del banco (1 de 48 corridas): tras enviar el WhatsApp, el
    // modelo devolvió tool_use sin herramientas; el runner agregó un mensaje
    // de usuario sin contenido y la API respondió 400.
    const h = buildHarness();
    h.createMessage
      .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
      .mockResolvedValueOnce(toolUseSinHerramientas())
      .mockResolvedValue(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    for (const [input] of h.createMessage.mock.calls) {
      for (const m of input.messages as Array<{ content: unknown }>) {
        const vacio =
          m.content === '' ||
          (Array.isArray(m.content) && m.content.length === 0);
        expect(vacio).toBe(false);
      }
    }
    expect(h.createMessage).toHaveBeenCalledTimes(2);
    expect(h.leads.escalateToHuman).not.toHaveBeenCalled();
  });

  it('si pasa antes de responder, escala como con el texto suelto', async () => {
    const h = buildHarness();
    h.createMessage
      .mockResolvedValueOnce(toolUseSinHerramientas())
      .mockResolvedValue(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.createMessage).toHaveBeenCalledTimes(1);
    expect(h.leads.escalateToHuman).toHaveBeenCalledWith('lead-1');
  });

  describe('con ANTHROPIC_TOOL_CHOICE=auto (modelos que no aceptan forzar herramientas)', () => {
    // Sonnet 5.5, Opus 5.5 y Fable 5.1 responden 400 a tool_choice "any".
    it('no fuerza el uso de herramientas', async () => {
      const h = buildHarness(true, { toolChoice: 'auto' });
      h.createMessage
        .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
        .mockResolvedValue(endTurn());

      await inTenant(() => h.runner.runTurn('lead-1'));

      expect(h.createMessage.mock.calls[0][0].toolChoice).toBeUndefined();
    });

    it('si termina en texto sin haber respondido, le recuerda una vez que use una herramienta', async () => {
      const h = buildHarness(true, { toolChoice: 'auto' });
      h.createMessage
        .mockResolvedValueOnce(endTurn())
        .mockResolvedValueOnce(toolUse('enviarWhatsApp', { mensaje: 'hola' }))
        .mockResolvedValue(endTurn());

      await inTenant(() => h.runner.runTurn('lead-1'));

      const segunda = h.createMessage.mock.calls[1][0].messages;
      const recordatorio = segunda[segunda.length - 1];
      expect(recordatorio.role).toBe('user');
      expect(recordatorio.content).toContain('INSTRUCCIÓN DEL SISTEMA');
      expect(recordatorio.content).toContain('enviarWhatsApp');
      expect(h.enviar.execute).toHaveBeenCalledTimes(1);
      // Respondió con la herramienta: no hace falta el aviso de respaldo.
      expect(h.whatsapp.send).not.toHaveBeenCalled();
    });

    it('si vuelve a terminar en texto, no insiste: escala con el aviso', async () => {
      const h = buildHarness(true, { toolChoice: 'auto' });
      h.createMessage.mockResolvedValue(endTurn());

      await inTenant(() => h.runner.runTurn('lead-1'));

      expect(h.createMessage).toHaveBeenCalledTimes(2);
      expect(h.leads.escalateToHuman).toHaveBeenCalledWith('lead-1');
      expect(h.whatsapp.send).toHaveBeenCalledWith(
        '+56911111111',
        FALLBACK_ESCALATION_MESSAGE,
      );
    });
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

  it('si escala sin haberle escrito al cliente, le avisa que lo contactará una persona', async () => {
    // Caso del banco (repite-dato-del-cliente): el modelo escaló de entrada
    // y el cliente se quedó sin una sola palabra.
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(
      toolUse('escalarAHumano', { motivo: 'pedido incompleto' }),
    );

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.whatsapp.send).toHaveBeenCalledWith(
      '+56911111111',
      FALLBACK_ESCALATION_MESSAGE,
    );
    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        direction: 'outbound',
        content: FALLBACK_ESCALATION_MESSAGE,
      }),
    );
  });

  it('si ya le había escrito antes de escalar, no le manda otro aviso', async () => {
    const h = buildHarness();
    h.createMessage
      .mockResolvedValueOnce(
        toolUse('enviarWhatsApp', { mensaje: 'Reviso tu caso' }),
      )
      .mockResolvedValueOnce(
        toolUse('escalarAHumano', { motivo: 'pedido incompleto' }),
      );

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(h.whatsapp.send).not.toHaveBeenCalled();
  });

  it('en un seguimiento proactivo que escala no manda el aviso (el cliente no escribió)', async () => {
    const h = buildHarness();
    h.createMessage.mockResolvedValueOnce(
      toolUse('escalarAHumano', { motivo: 'no sé qué ofrecer' }),
    );

    await inTenant(() =>
      h.runner.runFollowUp('lead-1', 'reintenta el contacto'),
    );

    expect(h.whatsapp.send).not.toHaveBeenCalled();
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

describe('AgentRunner y la voz', () => {
  const llamar = {
    name: 'iniciarLlamada',
    definition: {
      name: 'iniciarLlamada',
      description: 'llama',
      input_schema: { type: 'object' as const, properties: {} },
    },
    execute: jest.fn(),
  } as unknown as AgentTool;

  function nombresDeHerramientas(h: ReturnType<typeof buildHarness>) {
    return (
      h.createMessage.mock.calls[0][0].tools as Array<{ name: string }>
    ).map((t) => t.name);
  }

  it('si la empresa no puede llamar, el agente no tiene iniciarLlamada (no ofrece una llamada que no saldrá)', async () => {
    const voice = {
      availability: jest.fn().mockResolvedValue({
        mode: 'managed',
        canCall: false,
        reason: 'Se acabaron los minutos',
      }),
    } as unknown as VoiceService;
    const h = buildHarness(true, { voice, extraTools: [llamar] });
    h.createMessage.mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(nombresDeHerramientas(h)).not.toContain('iniciarLlamada');
  });

  it('con voz disponible, la herramienta sigue ahí', async () => {
    const voice = {
      availability: jest.fn().mockResolvedValue({ mode: 'byo', canCall: true }),
    } as unknown as VoiceService;
    const h = buildHarness(true, { voice, extraTools: [llamar] });
    h.createMessage.mockResolvedValueOnce(endTurn());

    await inTenant(() => h.runner.runTurn('lead-1'));

    expect(nombresDeHerramientas(h)).toContain('iniciarLlamada');
  });
});
