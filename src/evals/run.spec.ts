import { condicionesPara, parseArgs } from './run';

describe('parseArgs', () => {
  it('toma el filtro de casos', () => {
    expect(parseArgs(['precio'])).toEqual({
      filtro: 'precio',
      sin: [],
      ablacion: false,
    });
  });

  it('lee las piezas apagadas y el filtro en cualquier orden', () => {
    expect(parseArgs(['memoria', '--sin=resumen,hechos'])).toEqual({
      filtro: 'memoria',
      sin: ['resumen', 'hechos'],
      ablacion: false,
    });
  });

  it('reconoce la ablación completa', () => {
    expect(parseArgs(['--ablacion']).ablacion).toBe(true);
  });

  it('rechaza una pieza que no existe, diciendo cuáles hay', () => {
    expect(() => parseArgs(['--sin=ejemplos'])).toThrow(/resumen, hechos/);
  });

  it('no mezcla la ablación con --sin', () => {
    expect(() => parseArgs(['--ablacion', '--sin=hechos'])).toThrow(
      /--ablacion/,
    );
  });
});

describe('condicionesPara', () => {
  it('sin opciones corre una sola condición, completa', () => {
    expect(condicionesPara({ sin: [], ablacion: false })).toEqual([
      { nombre: 'completo', sin: [] },
    ]);
  });

  it('con --sin corre solo esa condición', () => {
    expect(condicionesPara({ sin: ['hechos'], ablacion: false })).toEqual([
      { nombre: 'sin hechos', sin: ['hechos'] },
    ]);
  });

  it('la ablación apaga cada pieza por separado y luego todas', () => {
    expect(condicionesPara({ sin: [], ablacion: true })).toEqual([
      { nombre: 'completo', sin: [] },
      { nombre: 'sin resumen', sin: ['resumen'] },
      { nombre: 'sin hechos', sin: ['hechos'] },
      { nombre: 'sin memoria', sin: ['resumen', 'hechos'] },
    ]);
  });
});
