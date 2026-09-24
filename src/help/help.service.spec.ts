import { ServiceUnavailableException } from '@nestjs/common';
import { HelpService } from './help.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { CredentialsService } from '../integrations/credentials.service';
import { PromptService } from '../prompts/prompt.service';

function buildHarness(configured = true) {
  const prisma = {
    db: {
      agent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'agent-cobranza-1',
            name: 'Agente que cobra',
            type: 'COBRANZA',
            isActive: true,
          },
        ]),
      },
    },
  } as unknown as PrismaService;
  const anthropic = {
    isConfigured: jest.fn().mockReturnValue(configured),
    createMessage: jest.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'Puedes crear un agente desde /agents.' },
      ],
    }),
  } as unknown as AnthropicService;
  const credentials = {
    status: jest.fn().mockResolvedValue([
      {
        channel: 'whatsapp',
        provider: 'ycloud',
        configured: true,
        isActive: true,
      },
    ]),
  } as unknown as CredentialsService;
  const prompts = {
    getActiveContent: jest
      .fn()
      .mockResolvedValue('Eres un agente de cobranza. No inventes cifras.'),
  } as unknown as PromptService;
  return {
    service: new HelpService(prisma, anthropic, credentials, prompts),
    prisma,
    anthropic,
    credentials,
    prompts,
  };
}

function toolUse(name: string, input: Record<string, unknown>) {
  return { content: [{ type: 'tool_use', id: 'tu-1', name, input }] };
}

describe('HelpService.ask', () => {
  it('lanza si no hay LLM configurado', async () => {
    const { service } = buildHarness(false);
    await expect(
      service.ask([{ role: 'user', text: '¿cómo creo un agente?' }]),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('arma el system prompt con documentación, el estado real de la empresa (incl. prompt actual) y las 4 tools', async () => {
    const { service, anthropic, prompts } = buildHarness();

    const result = await service.ask([
      { role: 'user', text: '¿ya tengo WhatsApp conectado?' },
    ]);

    expect(result).toEqual({ reply: 'Puedes crear un agente desde /agents.' });
    const call = (anthropic.createMessage as jest.Mock).mock.calls[0][0];
    expect(call.tools.map((t: { name: string }) => t.name)).toEqual([
      'proponerAgente',
      'proponerEdicionAgente',
      'proponerEliminarAgente',
      'proponerPromptAgente',
    ]);
    expect(call.messages).toEqual([
      { role: 'user', content: '¿ya tengo WhatsApp conectado?' },
    ]);
    expect(prompts.getActiveContent).toHaveBeenCalledWith(
      'agent-cobranza-1',
      'COBRANZA',
    );

    // El system va en dos bloques: documentación (cacheada) + estado real.
    const [documentacion, estado] = call.system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(documentacion.cache_control).toEqual({ type: 'ephemeral' });
    expect(estado.cache_control).toBeUndefined();

    expect(estado.text).toContain('id=agent-cobranza-1');
    expect(estado.text).toContain('Agente que cobra');
    expect(estado.text).toContain('No inventes cifras');
    expect(estado.text).toContain('whatsapp: configurado (ycloud)');
    expect(estado.text).toContain('crm: sin configurar');
  });

  it('le da al asistente el recorrido del panel, no solo la puesta en marcha', async () => {
    const { service, anthropic } = buildHarness();

    await service.ask([{ role: 'user', text: '¿cómo importo mis leads?' }]);

    const [documentacion] = (anthropic.createMessage as jest.Mock).mock
      .calls[0][0].system as Array<{ text: string }>;

    // Lo que el panel tiene y la guía de puesta en marcha no cubría.
    for (const tema of [
      'Importar leads desde otro CRM',
      'Calificación del lead',
      'Plantillas de WhatsApp',
      'Secreto de firma del webhook',
      'Memoria del lead',
      'Mi cuenta',
      'Calendario',
      'Configuración',
      'Acceso MCP',
    ]) {
      expect(`${tema}: ${documentacion.text.includes(tema)}`).toBe(
        `${tema}: true`,
      );
    }
  });

  describe('crear', () => {
    it('devuelve la propuesta estructurada cuando el modelo llama proponerAgente', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: 'Agente de ventas nuevo',
          tipo: 'VENTAS',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'sí, créalo así' },
      ]);

      expect(result.proposal).toEqual({
        kind: 'create',
        name: 'Agente de ventas nuevo',
        type: 'VENTAS',
        description: undefined,
        channels: undefined,
        leadStates: undefined,
        isDefault: undefined,
      });
      expect(result.reply).toContain('Agente de ventas nuevo');
    });

    it('filtra canales/estados inválidos que el modelo pudiera inventar', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: 'Agente de cobranza',
          tipo: 'COBRANZA',
          canales: ['whatsapp', 'inventado'],
          estadosLead: ['ESCALADO_HUMANO', 'no_existe'],
          esPredeterminado: true,
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'que solo maneje los escalados por whatsapp' },
      ]);

      expect(result.proposal).toMatchObject({
        kind: 'create',
        channels: ['whatsapp'],
        leadStates: ['ESCALADO_HUMANO'],
        isDefault: true,
      });
    });

    it('no propone crear un agente que ya existe (evita el duplicado)', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: 'Agente que cobra',
          tipo: 'COBRANZA',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'créame el agente de cobranza' },
      ]);

      expect(result.proposal).toBeUndefined();
      expect(result.reply).toContain('Ya existe');
    });

    it('ignora mayúsculas y espacios al detectar el duplicado', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: '  AGENTE QUE COBRA ',
          tipo: 'COBRANZA',
        }),
      );

      const result = await service.ask([{ role: 'user', text: 'créalo' }]);
      expect(result.proposal).toBeUndefined();
    });

    it('si el homónimo está inactivo, sugiere reactivarlo en vez de duplicar', async () => {
      const { service, anthropic, prisma } = buildHarness();
      (prisma.db.agent.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'agent-1',
          name: 'Agente de agendamiento',
          type: 'AGENDAMIENTO',
          isActive: false,
        },
      ]);
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: 'Agente de agendamiento',
          tipo: 'AGENDAMIENTO',
        }),
      );

      const result = await service.ask([{ role: 'user', text: 'créalo' }]);
      expect(result.proposal).toBeUndefined();
      expect(result.reply).toContain('inactivo');
    });

    it('sí propone cuando el nombre no choca con ninguno existente', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', {
          nombre: 'Agente de agendamiento',
          tipo: 'AGENDAMIENTO',
        }),
      );

      const result = await service.ask([{ role: 'user', text: 'créalo' }]);
      expect(result.proposal).toMatchObject({
        kind: 'create',
        name: 'Agente de agendamiento',
      });
    });

    it('ignora un proponerAgente sin nombre o tipo válido', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerAgente', { nombre: '', tipo: 'VENTAS' }),
      );

      const result = await service.ask([
        { role: 'user', text: 'quiero un agente' },
      ]);

      expect(result.proposal).toBeUndefined();
    });
  });

  describe('editar', () => {
    it('arma el diff solo con los campos que cambian, resolviendo el agente por id', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerEdicionAgente', {
          agentId: 'agent-cobranza-1',
          descripcion: 'Cobranza blanda para clientes VIP',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'cámbiale la descripción al agente de cobranza' },
      ]);

      expect(result.proposal).toEqual({
        kind: 'update',
        agentId: 'agent-cobranza-1',
        agentName: 'Agente que cobra',
        changes: { description: 'Cobranza blanda para clientes VIP' },
      });
    });

    it('no propone nada si el agentId no existe en la empresa', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerEdicionAgente', {
          agentId: 'no-existe',
          nombre: 'x',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'edita ese agente' },
      ]);

      expect(result.proposal).toBeUndefined();
    });

    it('no propone nada si no viene ningún campo a cambiar', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerEdicionAgente', { agentId: 'agent-cobranza-1' }),
      );

      const result = await service.ask([
        { role: 'user', text: 'edita el agente de cobranza' },
      ]);

      expect(result.proposal).toBeUndefined();
    });
  });

  describe('eliminar', () => {
    it('arma la propuesta de eliminación resolviendo el agente por id', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerEliminarAgente', {
          agentId: 'agent-cobranza-1',
          motivo: 'ya no cobramos por este canal',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'elimina el agente de cobranza' },
      ]);

      expect(result.proposal).toEqual({
        kind: 'delete',
        agentId: 'agent-cobranza-1',
        agentName: 'Agente que cobra',
        reason: 'ya no cobramos por este canal',
      });
      expect(result.reply).toContain('Agente que cobra');
    });

    it('no propone nada si el agentId no existe en la empresa', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerEliminarAgente', { agentId: 'no-existe' }),
      );

      const result = await service.ask([
        { role: 'user', text: 'elimina ese agente' },
      ]);

      expect(result.proposal).toBeUndefined();
    });
  });

  describe('mejorar el prompt', () => {
    it('arma la propuesta con el contenido completo y el resumen del cambio', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValue(
        toolUse('proponerPromptAgente', {
          agentId: 'agent-cobranza-1',
          contenido:
            'Eres un agente de cobranza más directo. No inventes cifras.',
          resumenCambio: 'Lo hice más directo.',
        }),
      );

      const result = await service.ask([
        { role: 'user', text: 'hazlo más directo' },
      ]);

      expect(result.proposal).toEqual({
        kind: 'prompt',
        agentId: 'agent-cobranza-1',
        agentName: 'Agente que cobra',
        content: 'Eres un agente de cobranza más directo. No inventes cifras.',
        summary: 'Lo hice más directo.',
      });
      expect(result.reply).toContain('Agente que cobra');
    });

    it('no propone nada si falta el contenido o el agente no existe', async () => {
      const { service, anthropic } = buildHarness();
      (anthropic.createMessage as jest.Mock).mockResolvedValueOnce(
        toolUse('proponerPromptAgente', { agentId: 'agent-cobranza-1' }),
      );
      const sinContenido = await service.ask([
        { role: 'user', text: 'mejóralo' },
      ]);
      expect(sinContenido.proposal).toBeUndefined();

      (anthropic.createMessage as jest.Mock).mockResolvedValueOnce(
        toolUse('proponerPromptAgente', {
          agentId: 'no-existe',
          contenido: 'x',
        }),
      );
      const sinAgente = await service.ask([{ role: 'user', text: 'mejóralo' }]);
      expect(sinAgente.proposal).toBeUndefined();
    });
  });
});
