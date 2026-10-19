import { Agent, AppointmentStatus, Channel, Lead } from '@prisma/client';
import { ContextBuilder } from './context-builder.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PromptService } from '../prompts/prompt.service';
import { ExampleLibraryService } from '../improvement/example-library.service';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { ConversationRecallService } from '../memory/conversation-recall.service';
import { HISTORY_LIMIT } from './conversation-history';

interface MemoryFactLike {
  clave: string;
  valor: string;
  registradoEn: string;
}

const AGENT = {
  id: 'agent-1',
  type: 'VENTAS',
  name: 'Ventas',
} as unknown as Agent;

const LEAD = {
  id: 'lead-1',
  name: 'Ana',
  phone: '+56911111111',
  status: 'NUEVO',
  source: 'landing',
  metadata: {},
  qualification: null,
  qualificationReason: null,
  nextActionAt: null,
  nextActionType: null,
} as unknown as Lead;

interface HarnessData {
  memory?: { summary: string | null; facts: MemoryFactLike[] };
  appointments?: Array<{
    title: string;
    startAt: Date;
    location: string | null;
  }>;
  notes?: Array<{ body: string; createdAt: Date }>;
  actions?: Array<{
    tool: string;
    input: unknown;
    isError: boolean;
    occurredAt: Date;
  }>;
  otherAgents?: Array<{
    name: string;
    type: string;
    description: string | null;
  }>;
  /** Cuántos mensajes hay en la ventana de historial. */
  ventana?: number;
  /** Lo último que escribió el cliente. */
  ultimoEntrante?: string;
  recuerdos?: jest.Mock;
}

function buildHarness(data: HarnessData = {}) {
  const agentAction = {
    findMany: jest.fn().mockResolvedValue(data.actions ?? []),
  };
  const prisma = {
    db: {
      agent: {
        findMany: jest.fn().mockResolvedValue(data.otherAgents ?? []),
      },
      // `handoffNote` busca el canal system; `fewShot`, el último entrante.
      interaction: {
        findFirst: jest.fn(
          ({ where }: { where: { channel?: unknown; direction?: unknown } }) =>
            Promise.resolve(
              where.channel !== Channel.system &&
                where.direction === 'inbound' &&
                data.ultimoEntrante
                ? { content: data.ultimoEntrante }
                : null,
            ),
        ),
        // La ventana de historial: del más nuevo al más viejo.
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: data.ventana ?? 0 }, (_, i) => ({
            occurredAt: new Date(Date.UTC(2026, 9, 10) - i * 3_600_000),
          })),
        ),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue(data.appointments ?? []),
      },
      leadNote: { findMany: jest.fn().mockResolvedValue(data.notes ?? []) },
      agentAction,
    },
  } as unknown as PrismaService;

  const prompts = {
    getActiveContent: jest.fn().mockResolvedValue('PROMPT BASE DEL AGENTE'),
  } as unknown as PromptService;
  const examples = {
    findSimilar: jest.fn().mockResolvedValue([]),
  } as unknown as ExampleLibraryService;

  const memory = {
    get: jest
      .fn()
      .mockResolvedValue(data.memory ?? { summary: null, facts: [] }),
  } as unknown as LeadMemoryService;

  const recuerdos = data.recuerdos ?? jest.fn().mockResolvedValue([]);
  const recall = { recall: recuerdos } as unknown as ConversationRecallService;

  return {
    builder: new ContextBuilder(prisma, prompts, examples, memory, recall),
    agentAction,
    recuerdos,
  };
}

describe('ContextBuilder.buildSystem — bloques y caché', () => {
  it('separa lo estable de lo variable y marca el punto de caché', async () => {
    const { builder } = buildHarness();

    const blocks = await builder.buildSystem(AGENT, LEAD, '+56922222222');

    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it('pone el prompt y las políticas en el bloque estable', async () => {
    const { builder } = buildHarness();

    const [estable] = await builder.buildSystem(AGENT, LEAD, '+56922222222');

    expect(estable.text).toContain('PROMPT BASE DEL AGENTE');
    expect(estable.text).toContain('Política de canales');
    expect(estable.text).toContain('Cómo leer el historial');
    expect(estable.text).toContain('Adjuntos que no puedes abrir');
    // Nada propio del lead: si entrara aquí, el prefijo cacheado cambiaría en
    // cada conversación y el caché no serviría de nada.
    expect(estable.text).not.toContain('Ana');
  });

  it('pone el contexto del lead y el guardrail en el bloque variable', async () => {
    const { builder } = buildHarness();

    const [, variable] = await builder.buildSystem(AGENT, LEAD, null, 'lunes');

    expect(variable.text).toContain('Contexto del lead');
    expect(variable.text).toContain('Ana');
    expect(variable.text).toContain('lunes');
    expect(variable.text.trimEnd()).toMatch(/escala a un humano\.$/);
  });
});

describe('ContextBuilder.buildSystem — antecedentes del lead', () => {
  const ahora = new Date();

  it('no agrega la sección si no hay nada que contar', async () => {
    const { builder } = buildHarness();

    const [, variable] = await builder.buildSystem(AGENT, LEAD);

    expect(variable.text).not.toContain('Antecedentes de este lead');
  });

  it('lista las citas vigentes para que no las vuelva a agendar', async () => {
    const { builder } = buildHarness({
      appointments: [
        {
          title: 'Demo del producto',
          startAt: new Date(ahora.getTime() + 86_400_000),
          location: 'Oficina',
        },
      ],
    });

    const [, variable] = await builder.buildSystem(
      AGENT,
      LEAD,
      null,
      undefined,
      'America/Santiago',
    );

    expect(variable.text).toContain('Citas ya agendadas');
    expect(variable.text).toContain('Demo del producto');
    expect(variable.text).toContain('Oficina');
  });

  it('solo pide citas futuras y programadas', async () => {
    const { builder } = buildHarness();
    await builder.buildSystem(AGENT, LEAD);

    const prisma = (builder as unknown as { prisma: PrismaService }).prisma;
    const call = (prisma.db.appointment.findMany as jest.Mock).mock.calls[0][0];

    expect(call.where.status).toBe(AppointmentStatus.PROGRAMADA);
    expect(call.where.startAt.gte).toBeInstanceOf(Date);
  });

  it('incluye las notas del equipo advirtiendo que no son para el cliente', async () => {
    const { builder } = buildHarness({
      notes: [
        {
          body: 'Prefiere que lo llamen después de las 18:00',
          createdAt: ahora,
        },
      ],
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD);

    expect(variable.text).toContain('Notas internas del equipo');
    expect(variable.text).toContain('Prefiere que lo llamen');
    expect(variable.text).toContain('NO se las leas al cliente');
  });

  it('resume las acciones previas sin incluir su resultado', async () => {
    const { builder } = buildHarness({
      actions: [
        {
          tool: 'consultarDato',
          input: { clave: 'precio_plan_pro' },
          isError: false,
          occurredAt: ahora,
        },
        {
          tool: 'consultarCrm',
          input: { consulta: 'estado de la cotización' },
          isError: true,
          occurredAt: ahora,
        },
      ],
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD);

    expect(variable.text).toContain('Lo que ya hiciste con este lead');
    expect(variable.text).toContain('consultarDato (precio_plan_pro)');
    expect(variable.text).toContain('— falló');
  });

  it('ordena las acciones de la más antigua a la más reciente', async () => {
    // La consulta las trae al revés (descendente, para quedarse con las 8
    // últimas); leerlas en orden cronológico es lo que cuenta la historia.
    const { builder } = buildHarness({
      actions: [
        {
          tool: 'agendarCita',
          input: { titulo: 'Demo' },
          isError: false,
          occurredAt: new Date(ahora.getTime() - 60_000),
        },
        {
          tool: 'consultarDato',
          input: { clave: 'precio' },
          isError: false,
          occurredAt: new Date(ahora.getTime() - 600_000),
        },
      ],
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD);

    expect(variable.text.indexOf('consultarDato')).toBeLessThan(
      variable.text.indexOf('agendarCita'),
    );
  });

  it('excluye los envíos de mensajes: ya se ven en el historial', async () => {
    const { builder, agentAction } = buildHarness();

    await builder.buildSystem(AGENT, LEAD);

    const where = agentAction.findMany.mock.calls[0][0].where;
    expect(where.tool.notIn).toEqual(
      expect.arrayContaining(['enviarWhatsApp', 'enviarCorreo']),
    );
  });
});

describe('ContextBuilder.buildSystem — mensajes viejos recuperados', () => {
  const viejo = {
    id: 'i-1',
    direction: 'inbound',
    channel: Channel.whatsapp,
    content: 'Somos 3 sucursales: Maipú, Ñuñoa y Providencia.',
    occurredAt: new Date('2026-08-11T15:00:00.000Z'),
    metadata: {},
    similarity: 0.2,
  };

  it('trae los mensajes viejos que se relacionan con lo último que escribió', async () => {
    const recuerdos = jest.fn().mockResolvedValue([viejo]);
    const { builder } = buildHarness({
      ventana: HISTORY_LIMIT,
      ultimoEntrante: '¿para cuántas sucursales era?',
      recuerdos,
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD, null);

    // Busca solo ANTES del mensaje más viejo de la ventana: lo de la ventana
    // el modelo ya lo ve.
    const masViejoDeLaVentana = new Date(
      Date.UTC(2026, 9, 10) - (HISTORY_LIMIT - 1) * 3_600_000,
    );
    expect(recuerdos).toHaveBeenCalledWith(
      'lead-1',
      '¿para cuántas sucursales era?',
      masViejoDeLaVentana,
    );
    expect(variable.text).toContain('De conversaciones anteriores');
    expect(variable.text).toContain('Cliente: Somos 3 sucursales');
  });

  it('si todo el historial cabe en la ventana, no busca nada', async () => {
    const recuerdos = jest.fn().mockResolvedValue([viejo]);
    const { builder } = buildHarness({
      ventana: HISTORY_LIMIT - 1,
      ultimoEntrante: '¿para cuántas sucursales era?',
      recuerdos,
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD, null);

    expect(recuerdos).not.toHaveBeenCalled();
    expect(variable.text).not.toContain('De conversaciones anteriores');
  });

  it('si la búsqueda falla, el turno sigue sin ese bloque', async () => {
    const { builder } = buildHarness({
      ventana: HISTORY_LIMIT,
      ultimoEntrante: '¿para cuántas sucursales era?',
      recuerdos: jest.fn().mockRejectedValue(new Error('embeddings caídos')),
    });

    const [, variable] = await builder.buildSystem(AGENT, LEAD, null);

    expect(variable.text).not.toContain('De conversaciones anteriores');
  });
});
