import { NotFoundException } from '@nestjs/common';
import { AgentRouterService } from './agent-router.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';

/** Construye un agente de prueba con valores por defecto razonables. */
function agent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a',
    name: 'A',
    type: 'VENTAS',
    description: null,
    channels: [] as string[],
    leadStates: [] as string[],
    priority: 0,
    isDefault: false,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

/** Router con una lista fija de agentes activos y un LLM configurable. */
function build(agents: ReturnType<typeof agent>[], configured = false) {
  const findMany = jest.fn().mockResolvedValue(agents);
  const complete = jest.fn();
  const prisma = { db: { agent: { findMany } } } as unknown as PrismaService;
  const anthropic = {
    isConfigured: () => configured,
    complete,
  } as unknown as AnthropicService;
  return { service: new AgentRouterService(prisma, anthropic), complete };
}

describe('AgentRouterService.route (canal → estado → clasificador)', () => {
  it('lanza si no hay agentes activos', async () => {
    const { service } = build([]);
    await expect(service.route()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('con un único agente lo devuelve sin llamar al LLM', async () => {
    const { service, complete } = build([agent({ id: 'solo' })]);
    await expect(service.route({ channel: 'whatsapp' })).resolves.toBe('solo');
    expect(complete).not.toHaveBeenCalled();
  });

  it('enruta por tipo de agente cuando se pide (cobranza)', async () => {
    const { service, complete } = build([
      agent({ id: 'ventas', type: 'VENTAS', isDefault: true }),
      agent({ id: 'cobranza', type: 'COBRANZA' }),
    ]);
    await expect(service.route({ agentType: 'COBRANZA' })).resolves.toBe(
      'cobranza',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('ignora el tipo si ningún agente es de ese tipo (no bloquea)', async () => {
    const { service } = build([
      agent({ id: 'ventas', type: 'VENTAS', isDefault: true }),
    ]);
    await expect(service.route({ agentType: 'COBRANZA' })).resolves.toBe(
      'ventas',
    );
  });

  it('filtra por canal: descarta a quien no atiende el canal', async () => {
    const { service } = build([
      agent({ id: 'mail', channels: ['email'] }),
      agent({ id: 'wa', channels: ['whatsapp'] }),
    ]);
    await expect(service.route({ channel: 'whatsapp' })).resolves.toBe('wa');
  });

  it('filtra por estado tras el canal', async () => {
    const { service } = build([
      agent({ id: 'ventas', channels: ['whatsapp'], leadStates: ['NUEVO'] }),
      agent({
        id: 'soporte',
        channels: ['whatsapp'],
        leadStates: ['ESCALADO_HUMANO'],
      }),
    ]);
    await expect(
      service.route({ channel: 'whatsapp', status: 'ESCALADO_HUMANO' }),
    ).resolves.toBe('soporte');
  });

  it('sin mensaje ni LLM, desempata por isDefault y luego priority', async () => {
    const { service } = build([
      agent({ id: 'baja', priority: 1 }),
      agent({ id: 'default', isDefault: true, priority: 0 }),
      agent({ id: 'alta', priority: 9 }),
    ]);
    await expect(service.route()).resolves.toBe('default');
  });

  it('sin default, desempata por mayor priority', async () => {
    const { service } = build([
      agent({ id: 'baja', priority: 1 }),
      agent({ id: 'alta', priority: 9 }),
    ]);
    await expect(service.route()).resolves.toBe('alta');
  });

  it('excluye al agente que deriva', async () => {
    const { service } = build([
      agent({ id: 'yo' }),
      agent({ id: 'otro', createdAt: new Date('2026-02-01') }),
    ]);
    await expect(service.route({ excludeAgentId: 'yo' })).resolves.toBe('otro');
  });

  it('usa el clasificador cuando hay varios candidatos, mensaje y LLM', async () => {
    const { service, complete } = build(
      [agent({ id: 'ventas' }), agent({ id: 'soporte' })],
      true,
    );
    complete.mockResolvedValue('1'); // índice del segundo candidato
    await expect(
      service.route({ message: 'no me funciona el producto' }),
    ).resolves.toBe('soporte');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('si el clasificador falla, cae al desempate determinista', async () => {
    const { service, complete } = build(
      [agent({ id: 'ventas', isDefault: true }), agent({ id: 'soporte' })],
      true,
    );
    complete.mockRejectedValue(new Error('boom'));
    await expect(service.route({ message: 'hola' })).resolves.toBe('ventas');
  });
});
