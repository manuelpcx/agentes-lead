import { VoyageEmbeddingsProvider, VOYAGE_BATCH_SIZE } from './voyage.provider';
import { EmbeddingsRateLimitError } from './embeddings-provider.interface';

const DIM = 4;

function respuesta(vectores: number[][], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      data: vectores.map((embedding, index) => ({ embedding, index })),
    }),
    text: async () => 'detalle',
  } as unknown as Response;
}

function vector(n: number): number[] {
  return [n, 0, 0, 0];
}

describe('VoyageEmbeddingsProvider', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  const provider = () =>
    new VoyageEmbeddingsProvider('key', 'voyage-3.5', DIM, { esperaMs: 0 });

  it('se identifica por proveedor, modelo y dimensión', () => {
    expect(provider().id).toBe('voyage:voyage-3.5:4');
  });

  it('pide la dimensión exacta de la columna y el tipo de entrada', async () => {
    fetchMock.mockResolvedValue(respuesta([vector(1)]));

    await provider().embed(['hola'], 'query');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      input: ['hola'],
      model: 'voyage-3.5',
      input_type: 'query',
      output_dimension: DIM,
    });
  });

  it('devuelve los vectores en el orden de entrada aunque lleguen desordenados', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { embedding: vector(2), index: 1 },
          { embedding: vector(1), index: 0 },
        ],
      }),
    });

    await expect(provider().embed(['a', 'b'])).resolves.toEqual([
      vector(1),
      vector(2),
    ]);
  });

  it(`parte en lotes de ${VOYAGE_BATCH_SIZE} y conserva el orden`, async () => {
    const textos = Array.from(
      { length: VOYAGE_BATCH_SIZE + 3 },
      (_, i) => `t${i}`,
    );
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(init.body as string) as { input: string[] };
      return respuesta(input.map((t) => vector(Number(t.slice(1)))));
    });

    const out = await provider().embed(textos);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(textos.length);
    expect(out[VOYAGE_BATCH_SIZE + 2]).toEqual(vector(VOYAGE_BATCH_SIZE + 2));
  });

  it('reintenta un 429 o un 5xx y sigue', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta([], 429))
      .mockResolvedValueOnce(respuesta([], 503))
      .mockResolvedValueOnce(respuesta([vector(1)]));

    await expect(provider().embed(['a'])).resolves.toEqual([vector(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('no reintenta un error de la petición (400, 401)', async () => {
    fetchMock.mockResolvedValue(respuesta([], 401));

    await expect(provider().embed(['a'])).rejects.toThrow('Voyage 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si el límite de uso persiste, lo dice con un error propio', async () => {
    // La reindexación lo distingue para esperar en vez de abortar.
    fetchMock.mockResolvedValue(respuesta([], 429));

    const error = await provider()
      .embed(['a'])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingsRateLimitError);
    expect((error as Error).message).toContain('Voyage 429');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras los reintentos', async () => {
    fetchMock.mockResolvedValue(respuesta([], 500));

    await expect(provider().embed(['a'])).rejects.toThrow('Voyage 500');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rechaza vectores de otra dimensión: no caben en la columna', async () => {
    fetchMock.mockResolvedValue(respuesta([[1, 0]]));

    await expect(provider().embed(['a'])).rejects.toThrow('dimensión');
  });

  it('sin textos no llama a la API', async () => {
    await expect(provider().embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('VoyageEmbeddingsProvider — umbrales', () => {
  it('usa umbrales distintos para conocimiento y mensajes, ajustables', () => {
    const porDefecto = new VoyageEmbeddingsProvider('k', 'voyage-3.5', 4);
    const ajustado = new VoyageEmbeddingsProvider('k', 'voyage-3.5', 4, {
      minSimilarity: 0.7,
      recallMinSimilarity: 0.35,
    });

    expect(porDefecto.minSimilarity).toBeGreaterThan(
      porDefecto.recallMinSimilarity,
    );
    expect(ajustado.minSimilarity).toBe(0.7);
    expect(ajustado.recallMinSimilarity).toBe(0.35);
  });
});
