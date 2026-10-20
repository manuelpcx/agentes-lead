import { Channel, Direction } from '@prisma/client';
import {
  ConversationRecallService,
  RECALL_TOP_K,
  RecalledInteraction,
  palabrasClave,
  seleccionarRecuerdos,
} from './conversation-recall.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { HISTORY_LIMIT } from '../agent/conversation-history';

function enTenant<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run({ companyId: 'company-1', correlationId: 't' }, fn);
}

function recuerdo(
  id: string,
  dia: number,
  similarity: number,
): RecalledInteraction {
  return {
    id,
    direction: Direction.inbound,
    channel: Channel.whatsapp,
    content: `mensaje ${id}`,
    occurredAt: new Date(`2026-08-${String(dia).padStart(2, '0')}T12:00:00Z`),
    similarity,
  };
}

describe('palabrasClave', () => {
  it('quita palabras vacías, tildes y plurales simples', () => {
    expect(
      palabrasClave('Hola, ¿para cuántas sucursales era la cotización?'),
    ).toEqual(['sucursal', 'cotizacion']);
  });

  it('un saludo o un "ok" no tiene palabras clave', () => {
    expect(palabrasClave('hola, ok gracias!')).toEqual([]);
  });
});

describe('seleccionarRecuerdos', () => {
  const SIN_RELACION = 'zzz';

  it('descarta lo que no se parece lo suficiente', () => {
    const out = seleccionarRecuerdos(
      [recuerdo('a', 1, 0.9), recuerdo('b', 2, 0.1)],
      SIN_RELACION,
    );

    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('rescata una coincidencia de palabras clave aunque el vector no la vea', () => {
    // Con el embedder local, dos mensajes cortos que comparten UNA palabra
    // quedan con similitud ~0.1: sin esto, la recuperación no se activa.
    const out = seleccionarRecuerdos(
      [
        {
          ...recuerdo('sucursales', 1, 0.1),
          content: 'Somos 3 sucursales: Maipú y Ñuñoa',
        },
        { ...recuerdo('otra-cosa', 2, 0.1), content: 'atienden los sábados?' },
      ],
      '¿me recuerdas para cuántas sucursales era?',
    );

    expect(out.map((r) => r.id)).toEqual(['sucursales']);
  });

  it('acepta el umbral del embedder', () => {
    const out = seleccionarRecuerdos(
      [recuerdo('a', 1, 0.5), recuerdo('b', 2, 0.7)],
      SIN_RELACION,
      0.6,
    );

    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it(`se queda con los ${RECALL_TOP_K} más parecidos y los ordena por fecha`, () => {
    const out = seleccionarRecuerdos(
      [
        recuerdo('viejo-poco', 1, 0.4),
        recuerdo('nuevo-mucho', 20, 0.95),
        recuerdo('medio', 10, 0.8),
        recuerdo('viejo-mucho', 2, 0.9),
        recuerdo('reciente', 15, 0.7),
        recuerdo('otro', 5, 0.35),
      ],
      SIN_RELACION,
    );

    // Los 4 más parecidos, contados como conversación: del más viejo al más nuevo.
    expect(out.map((r) => r.id)).toEqual([
      'viejo-mucho',
      'medio',
      'reciente',
      'nuevo-mucho',
    ]);
  });
});

function buildHarness(
  opts: {
    pendientes?: Array<{ id: string; direction: Direction; content: string }>;
    ventana?: number;
    sinIndexar?: number;
    filas?: RecalledInteraction[];
    minSimilarity?: number;
  } = {},
) {
  const findMany = jest.fn(async (args: { select?: { content?: boolean } }) =>
    args.select?.content
      ? (opts.pendientes ?? [])
      : Array.from({ length: opts.ventana ?? 0 }, (_, i) => ({
          occurredAt: new Date(Date.UTC(2026, 9, 1) - i * 60_000),
        })),
  );
  const count = jest.fn(async () => opts.sinIndexar ?? 0);
  const $executeRaw = jest.fn(async () => 1);
  const $queryRaw = jest.fn(async () => opts.filas ?? []);
  const prisma = {
    db: { interaction: { findMany, count } },
    raw: { $executeRaw, $queryRaw },
  } as unknown as PrismaService;

  const embedDocuments = jest.fn(async (texts: string[]) =>
    texts.map(() => [0.1, 0.2]),
  );
  const embedQuery = jest.fn(async () => [0.3, 0.4]);
  const embeddings = {
    embedDocuments,
    embedQuery,
    modelId: 'voyage:voyage-3.5:1024',
    recallMinSimilarity: opts.minSimilarity ?? 0.3,
  } as unknown as EmbeddingsService;

  return {
    service: new ConversationRecallService(prisma, embeddings),
    findMany,
    count,
    $executeRaw,
    $queryRaw,
    embedDocuments,
    embedQuery,
  };
}

describe('ConversationRecallService.indexPending', () => {
  it('embebe en un solo lote las interacciones sin indexar y las guarda con su empresa', async () => {
    const h = buildHarness({
      pendientes: [
        {
          id: 'i-1',
          direction: Direction.inbound,
          content: 'somos 3 sucursales',
        },
        { id: 'i-2', direction: Direction.outbound, content: 'perfecto' },
      ],
    });

    const n = await enTenant(() => h.service.indexPending('lead-1'));

    expect(n).toBe(2);
    expect(h.embedDocuments).toHaveBeenCalledTimes(1);
    expect(h.embedDocuments).toHaveBeenCalledWith([
      'Cliente: somos 3 sucursales',
      'Equipo: perfecto',
    ]);
    expect(h.$executeRaw).toHaveBeenCalledTimes(2);
    const valores = h.$executeRaw.mock.calls[0].slice(1) as unknown[];
    expect(valores).toEqual(
      expect.arrayContaining([
        'company-1',
        'lead-1',
        'i-1',
        'voyage:voyage-3.5:1024',
      ]),
    );
  });

  it('cuenta como pendiente lo indexado con otro modelo, y lo reemplaza', async () => {
    const h = buildHarness({
      pendientes: [{ id: 'i-1', direction: Direction.inbound, content: 'x' }],
    });

    await enTenant(() => h.service.indexPending('lead-1'));

    const where = (
      h.findMany.mock.calls[0][0] as unknown as { where: { OR: unknown[] } }
    ).where;
    expect(where.OR).toEqual([
      { embedding: { is: null } },
      {
        embedding: {
          is: { embeddingModel: { not: 'voyage:voyage-3.5:1024' } },
        },
      },
    ]);
    // Si ya existía el vector viejo, se sobrescribe con el del modelo actual.
    const [plantilla] = h.$executeRaw.mock.calls[0] as unknown as [string[]];
    const sql = plantilla.join('?');
    expect(sql).toContain('DO UPDATE');
  });

  it('sin nada pendiente no llama al proveedor de embeddings', async () => {
    const h = buildHarness({ pendientes: [] });

    await expect(
      enTenant(() => h.service.indexPending('lead-1')),
    ).resolves.toBe(0);
    expect(h.embedDocuments).not.toHaveBeenCalled();
  });
});

describe('ConversationRecallService.needsIndexing', () => {
  it('si todo el historial cabe en la ventana, no hace falta indexar todavía', async () => {
    const h = buildHarness({ ventana: HISTORY_LIMIT - 1, sinIndexar: 5 });

    await expect(
      enTenant(() => h.service.needsIndexing('lead-1')),
    ).resolves.toBe(false);
  });

  it('hace falta si hay mensajes sin indexar que ya salieron de la ventana', async () => {
    const h = buildHarness({ ventana: HISTORY_LIMIT, sinIndexar: 3 });

    await expect(
      enTenant(() => h.service.needsIndexing('lead-1')),
    ).resolves.toBe(true);
  });

  it('también cuenta los indexados con otro modelo', async () => {
    const h = buildHarness({ ventana: HISTORY_LIMIT, sinIndexar: 1 });

    await enTenant(() => h.service.needsIndexing('lead-1'));

    const where = (
      h.count.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }]
    )[0].where;
    expect(where.OR).toContainEqual({
      embedding: {
        is: { embeddingModel: { not: 'voyage:voyage-3.5:1024' } },
      },
    });
  });

  it('no hace falta si lo que salió de la ventana ya está indexado', async () => {
    const h = buildHarness({ ventana: HISTORY_LIMIT, sinIndexar: 0 });

    await expect(
      enTenant(() => h.service.needsIndexing('lead-1')),
    ).resolves.toBe(false);
  });
});

describe('ConversationRecallService.recall', () => {
  it('si lo último que escribió no tiene palabras clave, no busca nada', async () => {
    // Un "hola" traería saludos viejos: ruido, no memoria.
    const h = buildHarness();

    await expect(
      enTenant(() => h.service.recall('lead-1', 'hola, ok', new Date())),
    ).resolves.toEqual([]);
    expect(h.embedQuery).not.toHaveBeenCalled();
  });

  it('busca solo en mensajes anteriores a la ventana y aplica el umbral', async () => {
    const antes = new Date('2026-09-01T00:00:00Z');
    const h = buildHarness({
      filas: [recuerdo('a', 3, 0.8), recuerdo('b', 1, 0.05)],
    });

    const out = await enTenant(() =>
      h.service.recall('lead-1', '¿para cuántas sucursales era?', antes),
    );

    expect(h.embedQuery).toHaveBeenCalledWith('¿para cuántas sucursales era?');
    const valores = h.$queryRaw.mock.calls[0].slice(1) as unknown[];
    expect(valores).toEqual(
      expect.arrayContaining([
        'company-1',
        'lead-1',
        antes,
        'voyage:voyage-3.5:1024',
      ]),
    );
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('usa el umbral del embedder activo', async () => {
    // Con Voyage, un 0,8 puede no bastar si el umbral calibrado es más alto.
    const h = buildHarness({
      filas: [recuerdo('a', 3, 0.8)],
      minSimilarity: 0.85,
    });

    const out = await enTenant(() =>
      h.service.recall('lead-1', '¿para cuántas sucursales era?', new Date()),
    );

    expect(out).toEqual([]);
  });
});
