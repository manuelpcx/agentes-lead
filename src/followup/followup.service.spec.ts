import { ConfigService } from '@nestjs/config';
import { FollowUpService } from './followup.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AgentRunner } from '../agent/agent-runner.service';
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
} = {
  id: 'lead-1',
  status: 'NUEVO',
  isPausedForHuman: false,
  contactAttempts: 0,
  timezone: null,
  source: 'landing',
  email: 'lead@x.cl',
  phone: '+56911111111',
};

function buildHarness(
  overrides: Partial<typeof LEAD> = {},
  businessHours: unknown = ALWAYS_OPEN,
  template = '',
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
    db: { interaction: { findFirst: jest.fn().mockResolvedValue(null) } },
    raw: {
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ businessHours, timezone: 'UTC' }),
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
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
  });

  it('WhatsApp fuera de ventana, sin plantilla ni correo: cuenta el intento sin contactar', async () => {
    const h = buildHarness({ contactAttempts: 1, email: null });
    await run(() => h.service.processFollowUp('lead-1'));
    expect(h.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(h.agent.runFollowUp).not.toHaveBeenCalled();
    expect(h.leads.recordFollowUpAttempt).toHaveBeenCalledTimes(1);
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
