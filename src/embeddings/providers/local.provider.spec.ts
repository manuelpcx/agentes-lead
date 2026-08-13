import { LocalEmbeddingsProvider } from './local.provider';

const DIM = 1024;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

describe('LocalEmbeddingsProvider', () => {
  const provider = new LocalEmbeddingsProvider(DIM);

  it('produce vectores de la dimensión configurada', async () => {
    const [v] = await provider.embed(['hola mundo']);
    expect(v).toHaveLength(DIM);
  });

  it('es determinista: mismo texto ⇒ mismo vector', async () => {
    const [a] = await provider.embed(['consulta general de medicina']);
    const [b] = await provider.embed(['consulta general de medicina']);
    expect(a).toEqual(b);
  });

  it('produce vectores unitarios (norma L2 ≈ 1)', async () => {
    const [v] = await provider.embed(['texto con varias palabras distintas']);
    const norm = Math.sqrt(dot(v, v));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('textos con solapamiento léxico quedan más cerca que textos no relacionados', async () => {
    const [base] = await provider.embed(['precio de la consulta dental']);
    const [similar] = await provider.embed([
      'cuál es el precio de la consulta',
    ]);
    const [distinto] = await provider.embed([
      'horario de atención los sábados por la tarde',
    ]);
    expect(dot(base, similar)).toBeGreaterThan(dot(base, distinto));
  });
});
