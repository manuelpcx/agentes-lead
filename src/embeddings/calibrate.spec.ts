import { calibrar, PARES_CALIBRACION, ParDeCalibracion } from './calibrate';
import { EmbeddingsProvider } from './providers/embeddings-provider.interface';
import { LocalEmbeddingsProvider } from './providers/local.provider';

/** Embedder de juguete: cada texto es un vector fijo según su contenido. */
function fake(
  vectores: Record<string, number[]>,
  onEmbed?: (tipo?: string) => void,
): EmbeddingsProvider {
  return {
    id: 'fake',
    dimension: 2,
    minSimilarity: 0.5,
    recallMinSimilarity: 0.3,
    embed: async (texts, tipo) => {
      onEmbed?.(tipo);
      return texts.map((t) => vectores[t] ?? [1, 0]);
    },
  };
}

const par = (
  grupo: ParDeCalibracion['grupo'],
  sufijo: string,
): ParDeCalibracion => ({
  grupo,
  consulta: `q${sufijo}`,
  parecido: `si${sufijo}`,
  ajeno: `no${sufijo}`,
});

describe('calibrar', () => {
  it('sugiere un piso justo bajo lo relevante más bajo', async () => {
    const r = await calibrar(
      fake({ q: [1, 0], si: [0.8, 0.6], no: [0.2, 0.98] }),
      [par('conocimiento', '')],
    );

    expect(r.conocimiento?.separa).toBe(true);
    expect(r.conocimiento?.parecidos[0]).toBeCloseTo(0.8);
    // Lo relevante saca 0,8: el piso queda en 0,75, no en el punto medio.
    expect(r.conocimiento?.sugerido).toBe(0.75);
    expect(r.mensajes).toBeUndefined();
  });

  it('calibra cada grupo con sus propios puntajes', async () => {
    // Los mensajes puntúan más bajo que el conocimiento, pero cada grupo
    // separa bien por su cuenta: un umbral único no serviría.
    const r = await calibrar(
      fake({
        qa: [1, 0],
        sia: [0.9, 0.44],
        noa: [0.6, 0.8],
        qb: [1, 0],
        sib: [0.4, 0.92],
        nob: [0.2, 0.98],
      }),
      [par('conocimiento', 'a'), par('mensajes', 'b')],
    );

    expect(r.conocimiento?.separa).toBe(true);
    expect(r.mensajes?.separa).toBe(true);
    expect(r.conocimiento?.sugerido).toBeGreaterThan(r.mensajes!.sugerido);
  });

  it('cuenta los pares bien ordenados aunque el grupo no separe', async () => {
    const r = await calibrar(
      fake({
        q1: [1, 0],
        si1: [0.9, 0.44],
        no1: [0.6, 0.8],
        q2: [1, 0],
        si2: [0.5, 0.87],
        no2: [0.2, 0.98],
      }),
      [par('conocimiento', '1'), par('conocimiento', '2')],
    );

    // El ajeno del primero (0,6) le gana al parecido del segundo (0,5).
    expect(r.conocimiento?.separa).toBe(false);
    expect(r.conocimiento?.ordenCorrecto).toBe(2);
  });

  it('embebe consultas como "query" y textos como "document"', async () => {
    const tipos: Array<string | undefined> = [];

    await calibrar(
      fake({}, (t) => tipos.push(t)),
      [par('mensajes', '')],
    );

    expect(tipos).toEqual(['query', 'document']);
  });

  it('corre el banco completo con el embedder local, en los dos grupos', async () => {
    const r = await calibrar(new LocalEmbeddingsProvider(1024));
    const porGrupo = (g: string) =>
      PARES_CALIBRACION.filter((p) => p.grupo === g).length;

    expect(r.conocimiento?.parecidos).toHaveLength(porGrupo('conocimiento'));
    expect(r.mensajes?.parecidos).toHaveLength(porGrupo('mensajes'));
  });
});
