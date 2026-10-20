import {
  LeadMemoryService,
  REFRESH_EVERY_INTERACTIONS,
} from './lead-memory.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { MemoryFact } from './lead-memory';
import { ConversationRecallService } from './conversation-recall.service';

interface Row {
  id: string;
  leadId: string;
  summary: string | null;
  summarizedUpto: Date | null;
  facts: unknown;
  insights?: unknown;
  updatedAt: Date;
}

function buildHarness(
  options: {
    row?: Partial<Row>;
    interactions?: Array<{
      id?: string;
      direction: string;
      content: string;
      occurredAt: Date;
    }>;
    count?: number;
    configured?: boolean;
    complete?: jest.Mock;
    needsIndexing?: boolean;
    /** Llamadas nuevas desde el último resumen. */
    calls?: number;
    /** Escalamientos, promesas o derivaciones desde el último resumen. */
    eventos?: number;
  } = {},
) {
  const rows: Row[] = options.row
    ? [
        {
          id: 'mem-1',
          leadId: 'lead-1',
          summary: null,
          summarizedUpto: null,
          facts: [],
          updatedAt: new Date(),
          ...options.row,
        },
      ]
    : [];

  const leadMemory = {
    findFirst: jest.fn(async () => rows[0] ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: 'mem-1',
        updatedAt: new Date(),
        ...data,
      } as unknown as Row;
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(rows[0], data);
      return rows[0];
    }),
  };

  const complete =
    options.complete ?? jest.fn().mockResolvedValue('Resumen nuevo.');
  const anthropic = {
    isConfigured: () => options.configured !== false,
    complete,
  } as unknown as AnthropicService;

  const prisma = {
    db: {
      leadMemory,
      interaction: {
        findMany: jest.fn(async (args?: { take?: number }) =>
          [...(options.interactions ?? [])].reverse().slice(0, args?.take),
        ),
        count: jest.fn(async (args?: { where?: { channel?: unknown } }) =>
          args?.where?.channel === 'call'
            ? (options.calls ?? 0)
            : (options.count ?? 0),
        ),
      },
      agentAction: {
        count: jest.fn(async () => options.eventos ?? 0),
      },
    },
  } as unknown as PrismaService;

  const recall = {
    needsIndexing: jest.fn(async () => options.needsIndexing ?? false),
    indexPending: jest.fn(async () => 0),
  } as unknown as ConversationRecallService;

  return {
    service: new LeadMemoryService(prisma, anthropic, recall),
    leadMemory,
    complete,
    rows,
    recall,
  };
}

function enTenant<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run(
    { companyId: 'company-1', correlationId: 'test' },
    fn,
  );
}

describe('LeadMemoryService.get', () => {
  it('devuelve memoria vacía si el lead nunca guardó nada', async () => {
    const { service } = buildHarness();

    await expect(enTenant(() => service.get('lead-1'))).resolves.toEqual({
      summary: null,
      facts: [],
      insights: [],
      updatedAt: null,
    });
  });

  it('lee las conclusiones guardadas', async () => {
    const { service } = buildHarness({
      row: {
        insights: [
          { texto: 'Le importa el plazo', evidencia: ['i-1'], creadaEn: 'x' },
        ],
      },
    });

    const memoria = await enTenant(() => service.get('lead-1'));

    expect(memoria.insights).toEqual([
      { texto: 'Le importa el plazo', evidencia: ['i-1'], creadaEn: 'x' },
    ]);
  });

  it('lee el resumen y los hechos guardados', async () => {
    const { service } = buildHarness({
      row: {
        summary: 'Vuelve por una ampliación.',
        facts: [{ clave: 'objecion', valor: 'el plazo', registradoEn: 'x' }],
      },
    });

    const memoria = await enTenant(() => service.get('lead-1'));

    expect(memoria.summary).toBe('Vuelve por una ampliación.');
    expect(memoria.facts).toHaveLength(1);
  });
});

describe('LeadMemoryService.rememberFact', () => {
  it('crea la fila la primera vez', async () => {
    const { service, leadMemory } = buildHarness();

    const facts = await enTenant(() =>
      service.rememberFact('lead-1', 'Objeción', 'le parece caro'),
    );

    expect(leadMemory.create).toHaveBeenCalled();
    expect(facts).toEqual([
      expect.objectContaining({ clave: 'objecion', valor: 'le parece caro' }),
    ]);
  });

  it('actualiza la fila existente y no la duplica', async () => {
    const { service, leadMemory } = buildHarness({ row: {} });

    await enTenant(() => service.rememberFact('lead-1', 'a', 'uno'));

    expect(leadMemory.update).toHaveBeenCalled();
    expect(leadMemory.create).not.toHaveBeenCalled();
  });
});

describe('LeadMemoryService.forgetFact', () => {
  it('quita el hecho pedido', async () => {
    const { service } = buildHarness({
      row: {
        facts: [
          { clave: 'a', valor: '1', registradoEn: 'x' },
          { clave: 'b', valor: '2', registradoEn: 'x' },
        ],
      },
    });

    const facts = await enTenant(() => service.forgetFact('lead-1', 'a'));

    expect(facts.map((f: MemoryFact) => f.clave)).toEqual(['b']);
  });
});

describe('LeadMemoryService.needsRefresh', () => {
  it('no refresca si no hay LLM configurado', async () => {
    const { service } = buildHarness({ configured: false, count: 999 });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      false,
    );
  });

  const resumido = { summarizedUpto: new Date('2026-10-01T12:00:00Z') };

  it('no refresca con pocas interacciones nuevas', async () => {
    const { service } = buildHarness({
      row: resumido,
      count: REFRESH_EVERY_INTERACTIONS - 1,
    });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      false,
    );
  });

  it('un lead sin resumen tiene el primero con pocos mensajes', async () => {
    const { service } = buildHarness({ count: 3 });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });

  it('refresca tras una llamada aunque falten mensajes', async () => {
    const { service } = buildHarness({ row: resumido, count: 2, calls: 1 });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });

  it('refresca tras escalar, una promesa de pago o una derivación', async () => {
    const { service } = buildHarness({ row: resumido, count: 2, eventos: 1 });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });

  it('refresca cuando el cliente vuelve tras un silencio largo', async () => {
    const { service } = buildHarness({
      row: resumido,
      count: 2,
      interactions: [
        {
          direction: 'outbound',
          content: '¿seguimos?',
          occurredAt: new Date('2026-10-01T12:00:00Z'),
        },
        {
          direction: 'inbound',
          content: 'hola, perdón la demora',
          occurredAt: new Date('2026-10-12T09:00:00Z'),
        },
        {
          direction: 'outbound',
          content: '¡hola de nuevo!',
          occurredAt: new Date('2026-10-12T09:01:00Z'),
        },
      ],
    });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });

  it('una conversación seguida sin eventos no refresca', async () => {
    const { service } = buildHarness({
      row: resumido,
      count: 2,
      interactions: [
        {
          direction: 'outbound',
          content: '¿seguimos?',
          occurredAt: new Date('2026-10-01T12:00:00Z'),
        },
        {
          direction: 'inbound',
          content: 'sí',
          occurredAt: new Date('2026-10-01T12:10:00Z'),
        },
        {
          direction: 'outbound',
          content: 'perfecto',
          occurredAt: new Date('2026-10-01T12:11:00Z'),
        },
      ],
    });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      false,
    );
  });

  it('refresca al llegar al umbral', async () => {
    const { service } = buildHarness({ count: REFRESH_EVERY_INTERACTIONS });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });

  it('también hace falta si hay mensajes viejos sin indexar, aunque no toque resumir', async () => {
    // Un lead de antes de la recuperación: sus mensajes viejos no tienen
    // embedding y nadie los indexaría hasta 10 mensajes nuevos.
    const { service } = buildHarness({ count: 0, needsIndexing: true });

    await expect(enTenant(() => service.needsRefresh('lead-1'))).resolves.toBe(
      true,
    );
  });
});

describe('LeadMemoryService.refreshSummary', () => {
  const interacciones = [
    {
      direction: 'inbound',
      content: 'quiero el plan pro',
      occurredAt: new Date('2026-09-22T10:00:00.000Z'),
    },
    {
      direction: 'outbound',
      content: 'te mando el detalle',
      occurredAt: new Date('2026-09-22T10:05:00.000Z'),
    },
  ];

  it('guarda el resumen y hasta dónde llegó', async () => {
    const { service, rows } = buildHarness({
      row: {},
      interactions: interacciones,
    });

    await enTenant(() => service.refreshSummary('lead-1'));

    expect(rows[0].summary).toBe('Resumen nuevo.');
    expect(rows[0].summarizedUpto).toEqual(
      new Date('2026-09-22T10:05:00.000Z'),
    );
  });

  it('no hace nada si no hay conversación', async () => {
    const { service, leadMemory } = buildHarness({ interactions: [] });

    await enTenant(() => service.refreshSummary('lead-1'));

    expect(leadMemory.create).not.toHaveBeenCalled();
    expect(leadMemory.update).not.toHaveBeenCalled();
  });

  it('no rompe el turno si el modelo falla', async () => {
    const { service, rows } = buildHarness({
      row: { summary: 'el de antes' },
      interactions: interacciones,
      complete: jest.fn().mockRejectedValue(new Error('429')),
    });

    await expect(
      enTenant(() => service.refreshSummary('lead-1')),
    ).resolves.toBeUndefined();
    expect(rows[0].summary).toBe('el de antes');
  });

  it('ignora un resumen vacío', async () => {
    const { service, rows } = buildHarness({
      row: { summary: 'el de antes' },
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue('   '),
    });

    await enTenant(() => service.refreshSummary('lead-1'));

    expect(rows[0].summary).toBe('el de antes');
  });

  it('le prohíbe al modelo poner cifras exactas en el resumen', async () => {
    const { service, complete } = buildHarness({
      row: {},
      interactions: interacciones,
    });

    await enTenant(() => service.refreshSummary('lead-1'));

    expect(complete.mock.calls[0][0]).toContain('NO incluyas cifras exactas');
  });

  it('resume con el modelo de tareas de fondo', async () => {
    // Corre cada 10 interacciones de cada lead: es el mayor volumen de
    // llamadas fuera del turno.
    const { service, complete } = buildHarness({
      row: {},
      interactions: interacciones,
    });

    await enTenant(() => service.refreshSummary('lead-1'));

    expect(complete.mock.calls[0][2]).toEqual({ background: true });
  });
});

describe('LeadMemoryService.refreshInsights', () => {
  const interacciones = [
    {
      id: 'i-1',
      direction: 'inbound',
      content: 'quiero el plan pro pero me preocupa el plazo',
      occurredAt: new Date('2026-09-22T10:00:00.000Z'),
    },
    {
      id: 'i-2',
      direction: 'outbound',
      content: 'te mando el detalle',
      occurredAt: new Date('2026-09-22T10:05:00.000Z'),
    },
  ];
  const respuesta = JSON.stringify({
    conclusiones: [{ texto: 'Decide por el plazo', evidencia: ['#1'] }],
  });

  it('guarda las conclusiones con la evidencia traducida a ids reales', async () => {
    const { service, rows } = buildHarness({
      row: {},
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue(respuesta),
    });

    await enTenant(() => service.refreshInsights('lead-1'));

    expect(rows[0].insights).toEqual([
      expect.objectContaining({
        texto: 'Decide por el plazo',
        evidencia: ['i-1'],
      }),
    ]);
  });

  it('le muestra al modelo cada mensaje con su referencia, en orden', async () => {
    const { service, complete } = buildHarness({
      row: {},
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue(respuesta),
    });

    await enTenant(() => service.refreshInsights('lead-1'));

    const texto = complete.mock.calls[0][1] as string;
    expect(texto).toContain('#1 Cliente: quiero el plan pro');
    expect(texto).toContain('#2 Equipo: te mando el detalle');
  });

  it('usa el modelo de tareas de fondo', async () => {
    const { service, complete } = buildHarness({
      row: {},
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue(respuesta),
    });

    await enTenant(() => service.refreshInsights('lead-1'));

    expect(complete.mock.calls[0][2]).toEqual({ background: true });
  });

  it('si la respuesta no se puede leer, conserva las conclusiones anteriores', async () => {
    const anteriores = [
      { texto: 'La de antes', evidencia: ['i-0'], creadaEn: 'x' },
    ];
    const { service, rows } = buildHarness({
      row: { insights: anteriores },
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue('no sé qué responder'),
    });

    await enTenant(() => service.refreshInsights('lead-1'));

    expect(rows[0].insights).toEqual(anteriores);
  });

  it('no rompe nada si el modelo falla', async () => {
    const { service } = buildHarness({
      row: {},
      interactions: interacciones,
      complete: jest.fn().mockRejectedValue(new Error('429')),
    });

    await expect(
      enTenant(() => service.refreshInsights('lead-1')),
    ).resolves.toBeUndefined();
  });

  it('sin LLM no hace nada', async () => {
    const { service, complete } = buildHarness({
      configured: false,
      interactions: interacciones,
    });

    await enTenant(() => service.refreshInsights('lead-1'));

    expect(complete).not.toHaveBeenCalled();
  });
});

describe('LeadMemoryService.refreshFacts', () => {
  const interacciones = [
    {
      direction: 'inbound',
      content: 'lo tiene que aprobar mi socia',
      occurredAt: new Date('2026-10-01T10:00:00.000Z'),
    },
  ];
  const respuesta = (hechos: unknown[]) =>
    jest.fn().mockResolvedValue(JSON.stringify({ hechos }));

  it('anota lo que el agente no guardó', async () => {
    const { service, rows } = buildHarness({
      row: { facts: [] },
      interactions: interacciones,
      complete: respuesta([
        { clave: 'quien_decide', valor: 'su socia', importancia: 9 },
      ]),
    });

    await enTenant(() => service.refreshFacts('lead-1'));

    expect(rows[0].facts).toEqual([
      expect.objectContaining({
        clave: 'quien_decide',
        valor: 'su socia',
        importancia: 9,
      }),
    ]);
  });

  it('le muestra al modelo los hechos ya registrados y la conversación', async () => {
    const { service, complete } = buildHarness({
      row: {
        facts: [
          {
            clave: 'producto',
            valor: 'plan pro',
            importancia: 7,
            registradoEn: '2026-09-01T00:00:00.000Z',
          },
        ],
      },
      interactions: interacciones,
      complete: respuesta([]),
    });

    await enTenant(() => service.refreshFacts('lead-1'));

    const [, user, opts] = complete.mock.calls[0];
    expect(user).toContain('- producto: plan pro');
    expect(user).toContain('Cliente: lo tiene que aprobar mi socia');
    expect(opts).toEqual({ background: true });
  });

  it('no degrada un hecho que puso una persona desde el panel', async () => {
    const { service, rows } = buildHarness({
      row: {
        facts: [
          {
            clave: 'canal',
            valor: 'no llamar',
            importancia: 8,
            registradoEn: '2026-09-01T00:00:00.000Z',
          },
        ],
      },
      interactions: interacciones,
      complete: respuesta([
        { clave: 'canal', valor: 'prefiere correo', importancia: 3 },
      ]),
    });

    await enTenant(() => service.refreshFacts('lead-1'));

    expect(rows[0].facts).toEqual([
      expect.objectContaining({ valor: 'prefiere correo', importancia: 8 }),
    ]);
  });

  it('si la respuesta no se puede leer, deja la memoria como estaba', async () => {
    const { service, leadMemory } = buildHarness({
      row: { facts: [] },
      interactions: interacciones,
      complete: jest.fn().mockResolvedValue('no sé'),
    });

    await enTenant(() => service.refreshFacts('lead-1'));

    expect(leadMemory.update).not.toHaveBeenCalled();
  });

  it('no rompe nada si el modelo falla', async () => {
    const { service } = buildHarness({
      row: { facts: [] },
      interactions: interacciones,
      complete: jest.fn().mockRejectedValue(new Error('caído')),
    });

    await expect(
      enTenant(() => service.refreshFacts('lead-1')),
    ).resolves.toBeUndefined();
  });

  it('sin conversación no llama al modelo', async () => {
    const { service, complete } = buildHarness({ row: {}, interactions: [] });

    await enTenant(() => service.refreshFacts('lead-1'));

    expect(complete).not.toHaveBeenCalled();
  });
});

describe('LeadMemoryService.refresh', () => {
  it('si no toca resumir, solo indexa los mensajes', async () => {
    const { service, complete, recall } = buildHarness({
      row: {},
      count: 0,
      interactions: [],
    });

    await enTenant(() => service.refresh('lead-1'));

    expect(complete).not.toHaveBeenCalled();
    expect(recall.indexPending).toHaveBeenCalledWith('lead-1');
  });

  it('extrae hechos, rehace el resumen, después las conclusiones, y al final indexa', async () => {
    const { service, rows, recall } = buildHarness({
      count: REFRESH_EVERY_INTERACTIONS,
      row: {},
      interactions: [
        {
          id: 'i-1',
          direction: 'inbound',
          content: 'hola',
          occurredAt: new Date('2026-09-22T10:00:00.000Z'),
        },
      ],
      complete: jest
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            hechos: [{ clave: 'saludo', valor: 'saluda', importancia: 2 }],
          }),
        )
        .mockResolvedValueOnce('Resumen nuevo.')
        .mockResolvedValueOnce(
          JSON.stringify({
            conclusiones: [{ texto: 'A', evidencia: ['#1'] }],
          }),
        ),
    });

    await enTenant(() => service.refresh('lead-1'));

    expect(rows[0].facts).toEqual([
      expect.objectContaining({ clave: 'saludo', valor: 'saluda' }),
    ]);
    expect(rows[0].summary).toBe('Resumen nuevo.');
    expect(rows[0].insights).toEqual([
      expect.objectContaining({ texto: 'A', evidencia: ['i-1'] }),
    ]);
    expect(recall.indexPending).toHaveBeenCalledWith('lead-1');
  });
});
