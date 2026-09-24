import { AgentType, Channel, Direction } from '@prisma/client';
import { IniciarLlamadaTool } from './iniciar-llamada.tool';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ToolContext } from './tool.interface';

function build(opts: { llamadaReciente?: boolean } = {}) {
  const voice = {
    startCall: jest.fn().mockResolvedValue({ callId: 'call-1' }),
  };
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
    findRecent: jest
      .fn()
      .mockResolvedValue(opts.llamadaReciente ? { id: 'i-1' } : null),
    findProactiveSince: jest.fn().mockResolvedValue([]),
  };
  const leads = { scheduleNextAction: jest.fn().mockResolvedValue({}) };
  const tool = new IniciarLlamadaTool(
    voice as never,
    interactions as never,
    leads as never,
  );
  return { tool, voice, interactions, leads };
}

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    lead: { id: 'lead-1', phone: '+5215555555555', name: 'Ana' },
    agentId: 'ag-1',
    recordedFacts: [],
    timezone: 'America/Mexico_City',
    companyName: 'Tienda',
    companyVoice: {},
    followUp: false,
    escalated: false,
    messageSent: false,
    ...overrides,
  } as unknown as ToolContext;
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'company-1', correlationId: 'c1' }, fn);
}

describe('IniciarLlamadaTool', () => {
  it('llama cuando no hay otra llamada reciente', async () => {
    const h = build();
    const result = await run(() => h.tool.execute({ motivo: 'trivia' }, ctx()));

    expect(h.voice.startCall).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('call-1');
  });

  it('no vuelve a llamar si ya se lanzó una hace poco', async () => {
    const h = build({ llamadaReciente: true });
    const result = await run(() => h.tool.execute({ motivo: 'trivia' }, ctx()));

    expect(h.voice.startCall).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ya está sonando');
  });

  it('busca duplicados por llamadas salientes del propio lead', async () => {
    const h = build();
    await run(() => h.tool.execute({ motivo: 'trivia' }, ctx()));

    expect(h.interactions.findRecent).toHaveBeenCalledWith(
      'lead-1',
      Channel.call,
      Direction.outbound,
      expect.any(Date),
    );
  });

  it('agendar para más tarde no cuenta como llamada duplicada', async () => {
    const h = build({ llamadaReciente: true });
    const result = await run(() =>
      h.tool.execute({ motivo: 'trivia', programarEnMinutos: 30 }, ctx()),
    );

    expect(h.leads.scheduleNextAction).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
  });
});

describe('IniciarLlamadaTool — piso legal de cobranza', () => {
  afterEach(() => jest.useRealTimers());

  function at(iso: string) {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'queueMicrotask'],
    });
  }

  const cobranza = (overrides: Partial<ToolContext> = {}) =>
    ctx({ agentType: AgentType.COBRANZA, timezone: 'UTC', ...overrides });

  it('no llama fuera del horario legal aunque lo pida el deudor: ofrece agendar', async () => {
    at('2026-09-23T21:00:00Z');
    const h = build();

    const result = await run(() =>
      h.tool.execute({ motivo: 'deuda' }, cobranza()),
    );

    expect(h.voice.startCall).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.stop).toBe(false);
    expect(result.content).toContain('agendar');
  });

  it('máximo 1 llamada proactiva por semana', async () => {
    at('2026-09-24T15:00:00Z');
    const h = build();
    h.interactions.findProactiveSince.mockResolvedValue([
      { channel: 'call', occurredAt: new Date('2026-09-22T15:00:00Z') },
    ]);

    const result = await run(() =>
      h.tool.execute({ motivo: 'deuda' }, cobranza({ followUp: true })),
    );

    expect(h.voice.startCall).not.toHaveBeenCalled();
    expect(result.stop).toBe(true);
  });

  it('la llamada que pidió el deudor no cuenta para el tope semanal ni se marca', async () => {
    at('2026-09-24T15:00:00Z');
    const h = build();
    h.interactions.findProactiveSince.mockResolvedValue([
      { channel: 'call', occurredAt: new Date('2026-09-22T15:00:00Z') },
    ]);

    await run(() =>
      h.tool.execute(
        { motivo: 'deuda' },
        cobranza({ followUp: true, requestedByLead: true }),
      ),
    );

    expect(h.voice.startCall).toHaveBeenCalledTimes(1);
    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { callId: 'call-1' } }),
    );
  });

  it('una llamada proactiva queda marcada como gestión', async () => {
    at('2026-09-24T15:00:00Z');
    const h = build();

    await run(() =>
      h.tool.execute({ motivo: 'deuda' }, cobranza({ followUp: true })),
    );

    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { callId: 'call-1', gestion: 'proactiva' },
      }),
    );
  });

  it('en un seguimiento no agenda llamadas por iniciativa propia', async () => {
    at('2026-09-24T15:00:00Z');
    const h = build();

    const result = await run(() =>
      h.tool.execute(
        { motivo: 'deuda', programarEnMinutos: 30 },
        cobranza({ followUp: true }),
      ),
    );

    expect(h.leads.scheduleNextAction).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('si el deudor pide una hora fuera del horario legal, la corre al primer momento permitido', async () => {
    at('2026-09-26T15:00:00Z'); // sábado; pide las 21:00
    const h = build();

    const result = await run(() =>
      h.tool.execute(
        { motivo: 'deuda', programarParaHora: '21:00' },
        cobranza(),
      ),
    );

    // Sábado 21:00 no; domingo no → lunes 28 a las 8:00.
    expect(h.leads.scheduleNextAction).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-28T08:00:00Z'),
      'llamada_programada',
    );
    expect(result.content).toContain('fuera del horario legal');
  });
});
