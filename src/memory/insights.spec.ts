import { MAX_INSIGHTS, parseInsights, parseInsightsResponse } from './insights';

const NOW = new Date('2026-10-16T12:00:00.000Z');

/** Referencias cortas que ve el modelo (#n) → id real de la interacción. */
const REFS = new Map([
  ['#1', 'int-1'],
  ['#2', 'int-2'],
  ['#3', 'int-3'],
]);

describe('parseInsightsResponse', () => {
  it('convierte las referencias #n en ids de interacciones reales', () => {
    const out = parseInsightsResponse(
      JSON.stringify({
        conclusiones: [
          { texto: 'Su problema es de liquidez', evidencia: ['#1', '#3'] },
        ],
      }),
      REFS,
      NOW,
    );

    expect(out).toEqual([
      {
        texto: 'Su problema es de liquidez',
        evidencia: ['int-1', 'int-3'],
        creadaEn: NOW.toISOString(),
      },
    ]);
  });

  it('descarta la conclusión que no cita ningún mensaje real', () => {
    // La defensa contra que el modelo invente: sin evidencia no entra.
    const out = parseInsightsResponse(
      JSON.stringify({
        conclusiones: [
          { texto: 'Inventada', evidencia: ['#9'] },
          { texto: 'Sin evidencia', evidencia: [] },
          { texto: 'Respaldada', evidencia: ['#2'] },
        ],
      }),
      REFS,
      NOW,
    );

    expect(out?.map((c) => c.texto)).toEqual(['Respaldada']);
  });

  it('se queda solo con las referencias válidas de cada conclusión', () => {
    const out = parseInsightsResponse(
      JSON.stringify({
        conclusiones: [{ texto: 'X', evidencia: ['#2', '#7', '2', '#2'] }],
      }),
      REFS,
      NOW,
    );

    // "2" sin # cuenta como #2; los repetidos se juntan.
    expect(out?.[0].evidencia).toEqual(['int-2']);
  });

  it(`no guarda más de ${MAX_INSIGHTS} conclusiones`, () => {
    const conclusiones = Array.from({ length: 6 }, (_, i) => ({
      texto: `Conclusión ${i}`,
      evidencia: ['#1'],
    }));

    const out = parseInsightsResponse(
      JSON.stringify({ conclusiones }),
      REFS,
      NOW,
    );

    expect(out).toHaveLength(MAX_INSIGHTS);
  });

  it('tolera texto o markdown alrededor del JSON', () => {
    const out = parseInsightsResponse(
      '```json\n{"conclusiones":[{"texto":"A","evidencia":["#1"]}]}\n```',
      REFS,
      NOW,
    );

    expect(out?.map((c) => c.texto)).toEqual(['A']);
  });

  it('una lista vacía es una respuesta válida: no hay conclusiones', () => {
    expect(parseInsightsResponse('{"conclusiones":[]}', REFS, NOW)).toEqual([]);
  });

  it('devuelve null si no hay JSON legible (no se pisan las anteriores)', () => {
    expect(parseInsightsResponse('no sé', REFS, NOW)).toBeNull();
    expect(parseInsightsResponse('{"otra":1}', REFS, NOW)).toBeNull();
  });
});

describe('parseInsights', () => {
  it('lee lo guardado y descarta lo que no calza', () => {
    expect(
      parseInsights([
        { texto: 'A', evidencia: ['int-1'], creadaEn: 'x' },
        { texto: '', evidencia: ['int-1'] },
        { texto: 'Sin evidencia', evidencia: [] },
        'basura',
      ]),
    ).toEqual([{ texto: 'A', evidencia: ['int-1'], creadaEn: 'x' }]);
  });

  it('devuelve lista vacía ante cualquier cosa que no sea un arreglo', () => {
    expect(parseInsights(undefined)).toEqual([]);
    expect(parseInsights({})).toEqual([]);
  });
});
