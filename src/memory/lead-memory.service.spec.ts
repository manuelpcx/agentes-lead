import {
  LeadMemoryService,
  REFRESH_EVERY_INTERACTIONS,
} from './lead-memory.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { MemoryFact } from './lead-memory';

interface Row {
  id: string;
  leadId: string;
  summary: string | null;
  summarizedUpto: Date | null;
  facts: unknown;
  updatedAt: Date;
}

function buildHarness(
  options: {
    row?: Partial<Row>;
    interactions?: Array<{
      direction: string;
      content: string;
      occurredAt: Date;
    }>;
    count?: number;
    configured?: boolean;
    complete?: jest.Mock;
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
        findMany: jest.fn(async () =>
          [...(options.interactions ?? [])].reverse(),
        ),
        count: jest.fn(async () => options.count ?? 0),
      },
    },
  } as unknown as PrismaService;

  return {
    service: new LeadMemoryService(prisma, anthropic),
    leadMemory,
    complete,
    rows,
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
      updatedAt: null,
    });
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

  it('no refresca con pocas interacciones nuevas', async () => {
    const { service } = buildHarness({
      count: REFRESH_EVERY_INTERACTIONS - 1,
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
