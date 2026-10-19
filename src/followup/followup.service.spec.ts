import { ConfigService } from '@nestjs/config';
import { FollowUpService } from './followup.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AgentRunner } from '../agent/agent-runner.service';
import { VoiceService } from '../voice/voice.service';
import { TenantContext } from '../common/tenant/tenant-context';
import type { EnvVars } from '../common/config/env.validation';

const ALWAYS_OPEN = {
  days: {
    mon: [{ start: '00:00', end: '23:59' }],
    tue: [{ start: '00:00', end: '23:59' }],
    wed: [{ start: '00:00', end: '23:59' }],
    thu: [{ start: '00:00', end: '23:59' }],
    fri: [{ start: '00:00', end: '23:59' }],
    sat: [{ start: '00:00', end: '23:59' }],
    sun: [{ start: '00:00', end: '23:59' }],
  },
};

const LEAD: {
  id: string;
  status: string;
  isPausedForHuman: boolean;
  contactAttempts: number;
  timezone: string | null;
  source: string | null;
  email: string | null;
  phone: string | null;
  nextActionType: string | null;
  lastContactedAt: Date | null;
} = {
  id: 'lead-1',
  status: 'NUEVO',
  isPausedForHuman: false,
  contactAttempts: 0,
  timezone: null,
  source: 'landing',
  email: 'lead@x.cl',
  phone: '+56911111111',
  nextActionType: null,
  lastContactedAt: null,
};

function buildHarness(
  overrides: Partial<typeof LEAD> = {},
  businessHours: unknown = ALWAYS_OPEN,
  template = '',
  agentFollowupConfig: Record<string, unknown> = {},
  agentType = 'VENTAS',
  voice?: VoiceService,
) {
  const cfg: Record<string, unknown> = {
    FOLLOWUP_MAX_ATTEMPTS: 4,
    FOLLOWUP_BASE_DELAY_HOURS: 24,
    FOLLOWUP_DELAYS_HOURS: undefined,
    FOLLOWUP_CHANNEL_LADDER: undefined,
    FOLLOWUP_WHATSAPP_TEMPLATE: template,
    FOLLOWUP_WHATSAPP_TEMPLATE_LANG: 'es',
  };
  const config = {
    get: (k: string) => cfg[k],
  } as unknown as ConfigService<EnvVars, true>;

  const prisma = {
    db: {
      interaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        // Respuestas del lead (hora habitual): por defecto, ninguna.
        findMany: jest.fn().mockResolvedValue([]),
      },
      lead: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      agent: {
        findFirst: jest.fn().mockResolvedValue({
          followupConfig: agentFollowupConfig,
          type: agentType,
        }),
      },
    },
    raw: {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Estudio Demo',
          businessHours,
          timezone: 'UTC',
        }),
      },
    },
  } as unknown as PrismaService;

  const leads = {
    getById: jest.fn().mockResolvedValue({ ...LEAD, ...overrides }),
    scheduleNextAction: jest.fn().mockResolvedValue({}),
    recordFollowUpAttempt: jest.fn().mockResolvedValue({}),
    closeAsLost: jest.fn().mockResolvedValue({}),
  } as unknown as LeadsService;

  const interactions = {
    register: jest.fn().mockResolvedValue({}),
    // Gestiones proactivas previas del lead (para los topes de cobranza).
    findProactiveSince: jest.fn().mockResolvedValue([]),
  } as unknown as InteractionsService;

  const agent = {
    runFollowUp: jest
      .fn()
      .mockResolvedValue({ messageSent: true, escalated: false }),
  } as unknown as AgentRunner;

  const whatsapp = {
    send: jest.fn().mockResolvedValue(undefined),
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  } as unknown as WhatsappService;

  const service = new FollowUpService(
    config,
    prisma,
    leads,
    interactions,
    whatsapp,
    agent,
    voice,
  );
  return { service, prisma, leads, interactions, whatsapp, agent };
}

/** Marca la ventana de WhatsApp como abierta (WA entrante reciente). */
function openWhatsAppWindow(prisma: PrismaService) {
  (prisma.db.interaction.findFirst as jest.Mock)
    .mockResolvedValueOnce(null) // lastConv: nadie habló último
    .mockResolvedValueOnce({ occurredAt: new Date() }); // ventana abierta
}

function run(fn: () => Promise<void>) {
  return TenantContext.run({ companyId: 'company-1', correlationId: 'c1' }, fn);
}

describe('FollowUpService.processFollowUp', () => {
  it('no hace nada si el lead está en control humano', async () => {
    const h = buildHarness({ isPausedForHuman: true });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
  });

  it('no hace nada en estado terminal', async () => {
    const h = buildHarness({ status: 'CERRADO_GANADO' });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
  });

  it('si el cliente habló último, reprograma y no persigue', async () => {
    const h = buildHarness();
    (h.prisma.db.interaction.findFirst as jest.Mock).mockResolvedValueOnce({
      direction: 'inbound',
    });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.scheduleNextAction).toHaveBeenCalled();
  });

  it('fuera de horario: reprograma, no contacta', async () => {
    const h = buildHarness(
      {},
      {
        days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.scheduleNextAction).toHaveBeenCalled();
  });

  it('cierra por no-respuesta al superar el tope de intentos', async () => {
    const h = buildHarness({ contactAttempts: 4 });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.leads.closeAsLost).toHaveBeenCalledWith('lead-1');
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
  });

  it('con ventana de WhatsApp abierta: corre el agente por WhatsApp y reprograma', async () => {
    const h = buildHarness({ contactAttempts: 1 });
    openWhatsAppWindow(h.prisma);
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
    // Intento 2 en la escalera por defecto (email,whatsapp,...) → WhatsApp.
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('WHATSAPP');
  });

  it('WhatsApp fuera de ventana sin plantilla: cae a correo', async () => {
    // Intento 2 = WhatsApp, pero la ventana está cerrada (findFirst → null) y no
    // hay plantilla configurada: debe usar correo en su lugar.
    const h = buildHarness({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.whatsapp.sendTemplate).not.toHaveBeenCalled();
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('CORREO');
  });

  it('WhatsApp fuera de ventana con plantilla: envía plantilla y no corre el agente', async () => {
    const h = buildHarness({ contactAttempts: 1 }, ALWAYS_OPEN, 'bienvenida');
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, tpl] = (h.whatsapp.sendTemplate as jest.Mock).mock.calls[0];
    expect(to).toBe('+56911111111');
    expect(tpl).toMatchObject({ name: 'bienvenida', languageCode: 'es' });
    // {{1}} = nombre del lead (sin nombre → 'allí'), {{2}} = nombre de la empresa.
    expect(tpl.bodyParams).toEqual(['allí', 'Estudio Demo']);
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
    // La plantilla siempre es proactiva: queda marcada para los topes legales.
    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { gestion: 'proactiva' } }),
    );
  });

  it('la escalera del AGENTE pisa la global: fuerza whatsapp desde el primer intento', async () => {
    // Escalera global default = email primero; el agente pide solo whatsapp.
    const h = buildHarness({ contactAttempts: 0 }, ALWAYS_OPEN, '', {
      channelLadder: ['whatsapp'],
    });
    openWhatsAppWindow(h.prisma); // así no cae a la ventana cerrada/plantilla
    await run(() => h.service.processFollowUp('lead-1'));
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('WHATSAPP');
  });

  it('plantilla de REACTIVACIÓN del agente se usa en el último intento (attempt === maxAttempts)', async () => {
    const h = buildHarness(
      { contactAttempts: 3 }, // próximo intento = 4 = maxAttempts (tope=4)
      ALWAYS_OPEN,
      '',
      {
        channelLadder: ['whatsapp'],
        templates: {
          opening: { name: 'apertura', language: 'es' },
          reactivation: { name: 'reactiva_v1', language: 'es_CL' },
        },
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const [, tpl] = (h.whatsapp.sendTemplate as jest.Mock).mock.calls[0];
    expect(tpl).toMatchObject({ name: 'reactiva_v1', languageCode: 'es_CL' });
  });

  it('WhatsApp fuera de ventana, sin plantilla ni correo: cuenta el intento sin contactar', async () => {
    const h = buildHarness({ contactAttempts: 1, email: null });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
  });

  it('si la plantilla falla y hay correo: lo deja anotado y sigue por correo', async () => {
    const h = buildHarness({ contactAttempts: 1 }, ALWAYS_OPEN, 'bienvenida');
    (h.whatsapp.sendTemplate as jest.Mock).mockRejectedValue(
      new Error(
        'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)',
      ),
    );
    await run(() => h.service.processFollowUp('lead-1'));

    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('CORREO');
    // Queda a la vista en la conversación del lead, con el motivo.
    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'system',
        content: expect.stringMatching(/no tiene saldo.*correo/),
      }),
    );
    // La plantilla no salió: no se registra como gestión hecha.
    expect(h.interactions.register).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { gestion: 'proactiva' } }),
    );
  });

  it('si la plantilla falla y no hay correo: propaga el error para reintentar', async () => {
    const h = buildHarness(
      { contactAttempts: 1, email: null },
      ALWAYS_OPEN,
      'bienvenida',
    );
    const error = new Error(
      'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)',
    );
    (h.whatsapp.sendTemplate as jest.Mock).mockRejectedValue(error);

    await expect(
      run(() => h.service.processFollowUp('lead-1')),
    ).rejects.toThrow(error);
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    // Sin contacto no se cuenta el intento.
    expect(h.leads.recordFollowUpAttempt).not.toHaveBeenCalled();
  });

  it('llamada agendada por el lead: corre el agente con instrucción de llamada, sin pasar por el guard de "cliente habló último"', async () => {
    const h = buildHarness({
      contactAttempts: 1,
      nextActionType: 'llamada_programada',
    });
    // Aunque el cliente haya hablado último, la llamada agendada NO se pospone.
    (h.prisma.db.interaction.findFirst as jest.Mock).mockResolvedValueOnce({
      direction: 'inbound',
    });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.leads.scheduleNextAction).not.toHaveBeenCalled(); // no reprograma como espera
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('LLAMADA AGENDADA');
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
  });

  it('llamada agendada fuera de horario: la pospone conservando el tipo', async () => {
    const h = buildHarness(
      { contactAttempts: 1, nextActionType: 'llamada_programada' },
      {
        days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.scheduleNextAction).toHaveBeenCalledWith(
      'lead-1',
      expect.any(Date),
      'llamada_programada',
    );
  });

  it('primer contacto: escalera empieza por correo', async () => {
    const h = buildHarness({ contactAttempts: 0 });
    await run(() => h.service.processFollowUp('lead-1'));
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('CORREO');
    expect(instruction).toContain('enviarCorreo');
  });

  it('lead sin teléfono ni correo: cierra como inalcanzable', async () => {
    const h = buildHarness({ email: null, phone: null });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.closeAsLost).toHaveBeenCalledWith('lead-1');
  });

  it('si el agente escala, no reprograma como seguimiento', async () => {
    const h = buildHarness({ contactAttempts: 1 });
    (h.agent.runFollowUp as jest.Mock).mockResolvedValueOnce({
      messageSent: false,
      escalated: true,
    });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.leads.recordFollowUpAttempt).not.toHaveBeenCalled();
  });
});

/**
 * Piso legal de cobranza (Ley 19.496, art. 37). El reloj se fija para que cada
 * caso caiga en un día y hora concretos (zona horaria de la empresa: UTC).
 */
describe('FollowUpService — piso legal de cobranza', () => {
  afterEach(() => jest.useRealTimers());

  function at(iso: string) {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'queueMicrotask'],
    });
  }

  function cobranza(
    overrides: Partial<typeof LEAD> = {},
    opts: {
      businessHours?: unknown;
      followupConfig?: Record<string, unknown>;
      contacts?: Array<{ channel: string; occurredAt: Date }>;
    } = {},
  ) {
    const h = buildHarness(
      overrides,
      opts.businessHours ?? ALWAYS_OPEN,
      '',
      opts.followupConfig ?? {},
      'COBRANZA',
    );
    (h.interactions.findProactiveSince as jest.Mock).mockResolvedValue(
      opts.contacts ?? [],
    );
    return h;
  }

  /** Verifica que no hubo contacto y que se reprogramó para `iso` con `type`. */
  function expectPostponed(
    h: ReturnType<typeof buildHarness>,
    iso: string,
    type: string,
  ) {
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(h.leads.recordFollowUpAttempt).not.toHaveBeenCalled();
    expect(h.leads.scheduleNextAction).toHaveBeenCalledWith(
      'lead-1',
      new Date(iso),
      type,
    );
  }

  it('fuera de 8:00–20:00 no contacta, aunque el horario de la empresa sea 24/7', async () => {
    at('2026-09-23T21:00:00Z'); // miércoles 21:00
    const h = cobranza({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-24T08:00:00Z', 'fuera_de_horario');
  });

  it('el domingo no contacta, aunque la empresa atienda domingos', async () => {
    at('2026-09-27T12:00:00Z'); // domingo
    const h = cobranza({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-28T08:00:00Z', 'fuera_de_horario');
  });

  it('un feriado no contacta', async () => {
    at('2026-10-12T12:00:00Z'); // lunes 12 de octubre (Encuentro de Dos Mundos)
    const h = cobranza({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-10-13T08:00:00Z', 'fuera_de_horario');
  });

  it('deja al menos 48 h entre gestiones proactivas por mensajería', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza(
      { contactAttempts: 1 },
      {
        contacts: [
          { channel: 'whatsapp', occurredAt: new Date('2026-09-22T16:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-24T16:00:00Z', 'limite_legal');
  });

  it('máximo 2 gestiones proactivas por mensajería en la semana calendario', async () => {
    at('2026-09-25T15:00:00Z'); // viernes
    const h = cobranza(
      { contactAttempts: 2 },
      {
        contacts: [
          { channel: 'whatsapp', occurredAt: new Date('2026-09-23T10:00:00Z') },
          { channel: 'email', occurredAt: new Date('2026-09-21T10:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    // Se va al lunes siguiente, a la primera hora legal.
    expectPostponed(h, '2026-09-28T08:00:00Z', 'limite_legal');
  });

  it('las gestiones de la semana anterior no cuentan para el tope semanal', async () => {
    at('2026-09-28T10:00:00Z'); // lunes
    const h = cobranza(
      { contactAttempts: 2 },
      {
        contacts: [
          { channel: 'whatsapp', occurredAt: new Date('2026-09-25T09:00:00Z') },
          { channel: 'email', occurredAt: new Date('2026-09-23T10:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
  });

  it('máximo 1 llamada proactiva por semana', async () => {
    at('2026-09-24T15:00:00Z'); // jueves
    const h = cobranza(
      { contactAttempts: 1 },
      {
        followupConfig: { channelLadder: ['call'] },
        contacts: [
          { channel: 'call', occurredAt: new Date('2026-09-22T15:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-28T08:00:00Z', 'limite_legal');
  });

  it('una llamada no consume el tope ni el espaciado de la mensajería', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza(
      { contactAttempts: 1 },
      {
        contacts: [
          { channel: 'call', occurredAt: new Date('2026-09-23T10:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
  });

  it('la llamada que pidió el deudor no cuenta para el tope semanal', async () => {
    at('2026-09-24T15:00:00Z');
    const h = cobranza(
      { contactAttempts: 1, nextActionType: 'llamada_programada' },
      {
        contacts: [
          { channel: 'call', occurredAt: new Date('2026-09-22T15:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledWith(
      'lead-1',
      expect.stringContaining('LLAMADA AGENDADA'),
      { requestedByLead: true },
    );
  });

  it('la llamada que pidió el deudor igual respeta el horario legal', async () => {
    at('2026-09-27T12:00:00Z'); // domingo
    const h = cobranza({
      contactAttempts: 1,
      nextActionType: 'llamada_programada',
    });
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-28T08:00:00Z', 'llamada_programada');
  });

  it('verificar una promesa de pago también respeta los topes (sin perder el tipo)', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza(
      { contactAttempts: 1, nextActionType: 'promesa_pago' },
      {
        contacts: [
          { channel: 'whatsapp', occurredAt: new Date('2026-09-22T16:00:00Z') },
        ],
      },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expectPostponed(h, '2026-09-24T16:00:00Z', 'promesa_pago');
  });

  it('la config del agente no baja el espaciado de 48 h entre seguimientos', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza(
      { contactAttempts: 0 },
      { followupConfig: { delaysHours: [12, 12, 12] } },
    );
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-25T15:00:00Z'),
      'seguimiento',
    );
  });

  it('historial sin marca: respeta 48 h desde el último intento registrado', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza({
      contactAttempts: 1,
      lastContactedAt: new Date('2026-09-23T03:00:00Z'),
    });
    await run(() => h.service.processFollowUp('lead-1'));
    // 48 h después son las 03:00 del viernes: se corre a la primera hora legal.
    expectPostponed(h, '2026-09-25T08:00:00Z', 'limite_legal');
  });

  it('cuenta solo gestiones proactivas, desde el lunes o 48 h atrás (lo anterior)', async () => {
    at('2026-09-28T10:00:00Z'); // lunes: 48 h atrás es el sábado
    const h = cobranza({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.interactions.findProactiveSince).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-26T10:00:00Z'),
    );
  });

  it('le pide al agente una sola gestión por turno', async () => {
    at('2026-09-23T15:00:00Z');
    const h = cobranza({ contactAttempts: 0 });
    await run(() => h.service.processFollowUp('lead-1'));
    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).toContain('Límite legal de cobranza');
  });

  it('otros tipos de agente no tienen este piso', async () => {
    at('2026-09-23T21:00:00Z'); // miércoles 21:00, empresa 24/7
    const h = buildHarness({ contactAttempts: 1 });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.agent.runFollowUp).toHaveBeenCalledTimes(1);
    expect(h.interactions.findProactiveSince).not.toHaveBeenCalled();
  });
});

describe('FollowUpService — hora habitual del lead', () => {
  afterEach(() => jest.useRealTimers());

  function at(iso: string) {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'queueMicrotask'],
    });
  }

  /** Respuestas del lead a las 21:xx (UTC, la zona de la empresa en el arnés). */
  const RESPONDE_DE_NOCHE = [
    { occurredAt: new Date('2026-09-18T21:10:00Z') },
    { occurredAt: new Date('2026-09-19T21:40:00Z') },
    { occurredAt: new Date('2026-09-20T22:05:00Z') },
  ];

  it('corre el próximo seguimiento a la hora en que el lead suele responder', async () => {
    at('2026-09-23T15:00:00Z');
    const h = buildHarness({ contactAttempts: 1 });
    (h.prisma.db.interaction.findMany as jest.Mock).mockResolvedValue(
      RESPONDE_DE_NOCHE,
    );

    await run(() => h.service.processFollowUp('lead-1'));

    // Tocaba en 48 h (25-sep 15:00); suele responder a las 21 → 21:00.
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-25T21:00:00Z'),
      expect.any(String),
    );
  });

  it('sin un hábito claro, el seguimiento queda donde tocaba', async () => {
    at('2026-09-23T15:00:00Z');
    const h = buildHarness({ contactAttempts: 1 });

    await run(() => h.service.processFollowUp('lead-1'));

    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-25T15:00:00Z'),
      expect.any(String),
    );
  });

  it('en cobranza nunca lo adelanta (no puede achicar las 48 h legales)', async () => {
    at('2026-09-23T15:00:00Z');
    const h = buildHarness(
      { contactAttempts: 0 },
      ALWAYS_OPEN,
      '',
      {},
      'COBRANZA',
    );
    // Suele responder a las 9: adelantarlo a las 9:00 dejaría menos de 48 h.
    (h.prisma.db.interaction.findMany as jest.Mock).mockResolvedValue([
      { occurredAt: new Date('2026-09-18T09:10:00Z') },
      { occurredAt: new Date('2026-09-19T09:20:00Z') },
      { occurredAt: new Date('2026-09-20T09:05:00Z') },
    ]);

    await run(() => h.service.processFollowUp('lead-1'));

    // Queda en las 48 h (25-sep 15:00): las 9:00 de ese día serían antes, y
    // las del día siguiente están más allá del margen.
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledWith(
      'lead-1',
      new Date('2026-09-25T15:00:00Z'),
      expect.any(String),
    );
  });
});

describe('FollowUpService y la voz', () => {
  it('si la empresa no puede llamar, el intento de llamada sale por otro canal', async () => {
    const voice = {
      availability: jest.fn().mockResolvedValue({
        mode: 'managed',
        canCall: false,
        reason: 'Se acabaron los minutos',
      }),
    } as unknown as VoiceService;
    const h = buildHarness(
      { contactAttempts: 0 },
      ALWAYS_OPEN,
      '',
      { channelLadder: ['call'] },
      'VENTAS',
      voice,
    );

    await run(() => h.service.processFollowUp('lead-1'));

    const instruction = (h.agent.runFollowUp as jest.Mock).mock.calls[0][1];
    expect(instruction).not.toContain('LLAMADA');
    expect(instruction).toContain('CORREO');
  });

  it('con una escalera sin llamadas, ni pregunta por la voz', async () => {
    const voice = {
      availability: jest.fn(),
    } as unknown as VoiceService;
    const h = buildHarness(
      { contactAttempts: 0 },
      ALWAYS_OPEN,
      '',
      {},
      'VENTAS',
      voice,
    );

    await run(() => h.service.processFollowUp('lead-1'));

    expect(voice.availability).not.toHaveBeenCalled();
  });
});

describe('FollowUpService.deferAfterFailure', () => {
  const now = new Date('2026-10-06T19:30:00.000Z');
  const motivo =
    'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)';

  it('posterga una hora la próxima acción vencida, sin cambiar su tipo', async () => {
    const h = buildHarness();
    await run(() => h.service.deferAfterFailure('lead-1', motivo, now));

    const updateMany = h.prisma.db.lead.updateMany as jest.Mock;
    expect(updateMany).toHaveBeenCalledWith({
      // Solo si sigue vencida: no pisa algo que se haya agendado entretanto.
      where: { id: 'lead-1', nextActionAt: { lte: now } },
      data: { nextActionAt: new Date('2026-10-06T20:30:00.000Z') },
    });
  });

  it('deja el motivo a la vista en la conversación del lead', async () => {
    const h = buildHarness();
    await run(() => h.service.deferAfterFailure('lead-1', motivo, now));

    expect(h.interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        channel: 'system',
        content: expect.stringContaining('no tiene saldo'),
      }),
    );
  });

  it('no repite el mismo aviso cada hora', async () => {
    const h = buildHarness();
    // Ya hay un aviso igual en las últimas 24 h.
    (h.prisma.db.interaction.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'aviso-1',
    });
    await run(() => h.service.deferAfterFailure('lead-1', motivo, now));

    expect(h.prisma.db.lead.updateMany).toHaveBeenCalled();
    expect(h.interactions.register).not.toHaveBeenCalled();
  });

  it('si la acción ya no está vencida, no la toca ni avisa', async () => {
    const h = buildHarness();
    (h.prisma.db.lead.updateMany as jest.Mock).mockResolvedValueOnce({
      count: 0,
    });
    await run(() => h.service.deferAfterFailure('lead-1', motivo, now));

    expect(h.interactions.register).not.toHaveBeenCalled();
  });
});
