import { Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import {
  EmbeddingsReindexService,
  ESPERA_POR_LIMITE_MS,
  MAX_ESPERAS_POR_LIMITE,
  REINDEX_BATCH,
} from './embeddings-reindex.service';
import { EmbeddingsRateLimitError } from './providers/embeddings-provider.interface';

const MODELO = 'voyage:voyage-3.5:1024';

type Fila = { id: string; [k: string]: unknown };

/**
 * Base simulada con las tres tablas de vectores. `$queryRaw` devuelve las
 * filas de la tabla de la consulta que todavía no son del modelo activo, y
 * `$executeRaw` las marca como reindexadas.
 */
function buildHarness(tablas: {
  chunks?: Fila[];
  ejemplos?: Fila[];
  interacciones?: Fila[];
}) {
  const estado = {
    KnowledgeChunk: (tablas.chunks ?? []).map((f) => ({ ...f, m: 'local' })),
    ExampleLibrary: (tablas.ejemplos ?? []).map((f) => ({ ...f, m: 'local' })),
    InteractionEmbedding: (tablas.interacciones ?? []).map((f) => ({
      ...f,
      m: 'local',
    })),
  };
  const tablaDe = (sql: string) =>
    (Object.keys(estado) as Array<keyof typeof estado>).find(
      (t) => sql.includes(`FROM "${t}"`) || sql.includes(`UPDATE "${t}"`),
    )!;

  const $queryRaw = jest.fn(
    async (plantilla: TemplateStringsArray, ...valores: unknown[]) => {
      const tabla = tablaDe(plantilla.join('?'));
      const limite = valores.find((v) => typeof v === 'number') as number;
      return estado[tabla].filter((f) => f.m !== MODELO).slice(0, limite);
    },
  );
  const $executeRaw = jest.fn(
    async (plantilla: TemplateStringsArray, ...valores: unknown[]) => {
      const tabla = tablaDe(plantilla.join('?'));
      const id = valores[valores.length - 1];
      const fila = estado[tabla].find((f) => f.id === id);
      if (fila && fila.m !== MODELO) {
        fila.m = MODELO;
        return 1;
      }
      return 0;
    },
  );
  const prisma = {
    raw: { $queryRaw, $executeRaw },
  } as unknown as PrismaService;

  const embedDocuments = jest.fn(async (texts: string[]) =>
    texts.map(() => [0.1, 0.2]),
  );
  const embeddings = {
    modelId: MODELO,
    embedDocuments,
  } as unknown as EmbeddingsService;

  const service = new EmbeddingsReindexService(prisma, embeddings);
  // Sin esperas reales: se registra cuánto habría esperado.
  const esperar = jest
    .spyOn(
      service as unknown as { esperar: (ms: number) => Promise<void> },
      'esperar',
    )
    .mockResolvedValue(undefined);

  return {
    service,
    esperar,
    embedDocuments,
    $executeRaw,
    estado,
  };
}

describe('EmbeddingsReindexService.reindexAll', () => {
  it('sin vectores de otro modelo no llama al proveedor', async () => {
    const h = buildHarness({});

    await expect(h.service.reindexAll()).resolves.toEqual({
      fragmentos: 0,
      ejemplos: 0,
      interacciones: 0,
    });
    expect(h.embedDocuments).not.toHaveBeenCalled();
  });

  it('rehace los vectores de las tres tablas con el texto de cada una', async () => {
    const h = buildHarness({
      chunks: [{ id: 'c-1', texto: 'Atendemos de 9 a 18.' }],
      ejemplos: [
        { id: 'e-1', situation: 'pide precio', agentResponse: 'consulto' },
      ],
      interacciones: [
        { id: 'ie-1', direction: Direction.inbound, content: 'somos 3' },
      ],
    });

    await expect(h.service.reindexAll()).resolves.toEqual({
      fragmentos: 1,
      ejemplos: 1,
      interacciones: 1,
    });
    expect(h.embedDocuments.mock.calls.map((c) => c[0])).toEqual([
      ['Atendemos de 9 a 18.'],
      ['pide precio\nconsulto'],
      ['Cliente: somos 3'],
    ]);
    // Cada UPDATE guarda el modelo nuevo junto al vector.
    for (const [, ...valores] of h.$executeRaw.mock.calls) {
      expect(valores).toContain(MODELO);
    }
  });

  it(`avanza por lotes de ${REINDEX_BATCH} hasta terminar`, async () => {
    const chunks = Array.from({ length: REINDEX_BATCH + 5 }, (_, i) => ({
      id: `c-${i}`,
      texto: `fragmento ${i}`,
    }));
    const h = buildHarness({ chunks });

    const out = await h.service.reindexAll();

    expect(out.fragmentos).toBe(REINDEX_BATCH + 5);
    expect(h.embedDocuments).toHaveBeenCalledTimes(2);
    expect(h.estado.KnowledgeChunk.every((f) => f.m === MODELO)).toBe(true);
  });

  it('si el proveedor falla, se detiene y deja el resto para el próximo intento', async () => {
    const h = buildHarness({ chunks: [{ id: 'c-1', texto: 'x' }] });
    h.embedDocuments.mockRejectedValueOnce(new Error('Voyage 500'));

    await expect(h.service.reindexAll()).rejects.toThrow('Voyage 500');
    expect(h.estado.KnowledgeChunk[0].m).toBe('local');
  });

  it('no se queda en un bucle si otro proceso ya reindexó el lote', async () => {
    const h = buildHarness({ chunks: [{ id: 'c-1', texto: 'x' }] });
    // Otro proceso lo marca justo entre la lectura y la escritura.
    h.embedDocuments.mockImplementationOnce(async (texts: string[]) => {
      h.estado.KnowledgeChunk[0].m = MODELO;
      return texts.map(() => [0.1]);
    });

    await expect(h.service.reindexAll()).resolves.toEqual({
      fragmentos: 0,
      ejemplos: 0,
      interacciones: 0,
    });
  });

  it('ante el límite de uso espera y sigue con el mismo lote', async () => {
    const h = buildHarness({ chunks: [{ id: 'c-1', texto: 'x' }] });
    h.embedDocuments
      .mockRejectedValueOnce(new EmbeddingsRateLimitError('Voyage 429'))
      .mockRejectedValueOnce(new EmbeddingsRateLimitError('Voyage 429'));

    await expect(h.service.reindexAll()).resolves.toMatchObject({
      fragmentos: 1,
    });
    expect(h.esperar).toHaveBeenCalledTimes(2);
    expect(h.esperar).toHaveBeenCalledWith(ESPERA_POR_LIMITE_MS);
    expect(h.estado.KnowledgeChunk[0].m).toBe(MODELO);
  });

  it('las esperas se cuentan seguidas: un lote que pasa reinicia la cuenta', async () => {
    const chunks = Array.from({ length: REINDEX_BATCH * 2 }, (_, i) => ({
      id: `c-${i}`,
      texto: `f${i}`,
    }));
    const h = buildHarness({ chunks });
    // Choca casi el tope antes de cada lote; nunca llega a rendirse.
    for (let lote = 0; lote < 2; lote++) {
      for (let n = 0; n < MAX_ESPERAS_POR_LIMITE - 1; n++) {
        h.embedDocuments.mockRejectedValueOnce(
          new EmbeddingsRateLimitError('Voyage 429'),
        );
      }
      h.embedDocuments.mockImplementationOnce(async (texts: string[]) =>
        texts.map(() => [0.1]),
      );
    }

    await expect(h.service.reindexAll()).resolves.toMatchObject({
      fragmentos: REINDEX_BATCH * 2,
    });
  });

  it('si el límite no cede, se rinde y queda para el reintento largo', async () => {
    const h = buildHarness({ chunks: [{ id: 'c-1', texto: 'x' }] });
    h.embedDocuments.mockRejectedValue(
      new EmbeddingsRateLimitError('Voyage 429'),
    );

    await expect(h.service.reindexAll()).rejects.toThrow('Voyage 429');
    expect(h.esperar).toHaveBeenCalledTimes(MAX_ESPERAS_POR_LIMITE);
  });

  it('otros errores no esperan: abortan de inmediato', async () => {
    const h = buildHarness({ chunks: [{ id: 'c-1', texto: 'x' }] });
    h.embedDocuments.mockRejectedValueOnce(new Error('Voyage 401'));

    await expect(h.service.reindexAll()).rejects.toThrow('Voyage 401');
    expect(h.esperar).not.toHaveBeenCalled();
  });
});
