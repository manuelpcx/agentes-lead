import {
  MAX_EXTRAIDOS,
  mergeExtractedFacts,
  parseFactsResponse,
} from './fact-extraction';
import { MemoryFact, OPERATOR_IMPORTANCE } from './lead-memory';

describe('parseFactsResponse', () => {
  it('lee los hechos propuestos', () => {
    expect(
      parseFactsResponse(
        '{"hechos": [{"clave": "Quién decide", "valor": "la socia", "importancia": 9}]}',
      ),
    ).toEqual([{ clave: 'Quién decide', valor: 'la socia', importancia: 9 }]);
  });

  it('tolera fences de markdown e importancia como texto', () => {
    expect(
      parseFactsResponse(
        '```json\n{"hechos": [{"clave": "plazo", "valor": "marzo", "importancia": "7"}]}\n```',
      ),
    ).toEqual([{ clave: 'plazo', valor: 'marzo', importancia: 7 }]);
  });

  it('una lista vacía es "nada nuevo", no un error', () => {
    expect(parseFactsResponse('{"hechos": []}')).toEqual([]);
  });

  it('devuelve null si la respuesta no se puede leer', () => {
    expect(parseFactsResponse('no sé')).toBeNull();
    expect(parseFactsResponse('{"otra": 1}')).toBeNull();
  });

  it('descarta entradas sin clave o valor', () => {
    expect(
      parseFactsResponse(
        '{"hechos": [{"clave": "", "valor": "x"}, {"clave": "a"}, 3, {"clave": "ok", "valor": "sí"}]}',
      ),
    ).toEqual([{ clave: 'ok', valor: 'sí', importancia: 5 }]);
  });

  it(`se queda con ${MAX_EXTRAIDOS} por pasada`, () => {
    const hechos = Array.from({ length: 8 }, (_, i) => ({
      clave: `dato_${i}`,
      valor: 'v',
    }));
    expect(parseFactsResponse(JSON.stringify({ hechos }))).toHaveLength(
      MAX_EXTRAIDOS,
    );
  });
});

describe('mergeExtractedFacts', () => {
  const antes = new Date('2026-10-01T00:00:00Z');
  const ahora = new Date('2026-10-20T00:00:00Z');
  const hecho = (
    clave: string,
    valor: string,
    importancia: number,
  ): MemoryFact => ({
    clave,
    valor,
    importancia,
    registradoEn: antes.toISOString(),
  });

  it('agrega lo nuevo', () => {
    const out = mergeExtractedFacts(
      [hecho('producto', 'plan pro', 7)],
      [{ clave: 'Quién decide', valor: 'la socia', importancia: 9 }],
      ahora,
    );
    expect(out.map((f) => f.clave)).toEqual(['producto', 'quien_decide']);
  });

  it('no toca un hecho que no cambió (ni su fecha)', () => {
    const actuales = [hecho('producto', 'plan pro', 7)];
    const out = mergeExtractedFacts(
      actuales,
      [{ clave: 'producto', valor: 'Plan  pro ', importancia: 3 }],
      ahora,
    );
    expect(out).toEqual(actuales);
  });

  it('actualiza un valor que cambió sin bajarle la importancia', () => {
    const out = mergeExtractedFacts(
      [hecho('canal', 'no llamar', OPERATOR_IMPORTANCE)],
      [{ clave: 'canal', valor: 'solo por correo', importancia: 4 }],
      ahora,
    );
    expect(out).toEqual([
      {
        clave: 'canal',
        valor: 'solo por correo',
        importancia: OPERATOR_IMPORTANCE,
        registradoEn: ahora.toISOString(),
      },
    ]);
  });
});
