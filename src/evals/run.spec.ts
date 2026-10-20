import { agregarCorridas, condicionesPara, parseArgs } from './run';
import { EvalCase, EvalCheck, EvalResult } from './types';

describe('parseArgs', () => {
  it('toma el filtro de casos', () => {
    expect(parseArgs(['precio'])).toEqual({
      filtro: 'precio',
      sin: [],
      ablacion: false,
      repeticiones: 1,
    });
  });

  it('lee las piezas apagadas y el filtro en cualquier orden', () => {
    expect(parseArgs(['memoria', '--sin=resumen,hechos'])).toEqual({
      filtro: 'memoria',
      sin: ['resumen', 'hechos'],
      ablacion: false,
      repeticiones: 1,
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

  it('lee cuántas veces correr cada caso', () => {
    expect(parseArgs(['--repeticiones=3']).repeticiones).toBe(3);
  });

  it.each(['0', '-2', 'tres', '1.5', '11'])(
    'rechaza --repeticiones=%s (debe ser un entero de 1 a 10)',
    (valor) => {
      expect(() => parseArgs([`--repeticiones=${valor}`])).toThrow(/de 1 a 10/);
    },
  );
});

describe('condicionesPara', () => {
  const base = { sin: [], ablacion: false, repeticiones: 1 };

  it('sin opciones corre una sola condición, completa', () => {
    expect(condicionesPara(base)).toEqual([{ nombre: 'completo', sin: [] }]);
  });

  it('con --sin corre solo esa condición', () => {
    expect(condicionesPara({ ...base, sin: ['hechos'] })).toEqual([
      { nombre: 'sin hechos', sin: ['hechos'] },
    ]);
  });

  it('la ablación apaga cada pieza por separado y luego todas', () => {
    expect(condicionesPara({ ...base, ablacion: true })).toEqual([
      { nombre: 'completo', sin: [] },
      { nombre: 'sin resumen', sin: ['resumen'] },
      { nombre: 'sin hechos', sin: ['hechos'] },
      { nombre: 'sin reflexiones', sin: ['reflexiones'] },
      { nombre: 'sin recuperacion', sin: ['recuperacion'] },
      {
        nombre: 'sin memoria',
        sin: ['resumen', 'hechos', 'reflexiones', 'recuperacion'],
      },
    ]);
  });
});

describe('agregarCorridas', () => {
  const caso: EvalCase = {
    id: 'x',
    descripcion: 'caso de prueba',
    historial: [{ de: 'cliente', texto: 'hola' }],
    espera: { criterios: [] },
  };

  function corrida(
    checks: EvalCheck[],
    enviado = 'respuesta',
    acciones: EvalResult['run']['acciones'] = [],
  ): EvalResult {
    return {
      caso,
      run: {
        acciones,
        mensajes: [{ canal: 'whatsapp', texto: enviado }],
        escalado: false,
        system: '',
      },
      checks,
      ok: checks.every((c) => c.ok),
    };
  }

  it('cuenta, por criterio, en cuántas corridas se cumplió', () => {
    const agregado = agregarCorridas([
      corrida([
        { criterio: 'a', ok: true },
        { criterio: 'b', ok: true },
      ]),
      corrida(
        [
          { criterio: 'a', ok: true },
          { criterio: 'b', ok: false, detalle: 'falló b' },
        ],
        'primera que falla',
      ),
      corrida(
        [
          { criterio: 'a', ok: false, detalle: 'falló a' },
          { criterio: 'b', ok: false, detalle: 'otra vez b' },
        ],
        'segunda que falla',
      ),
    ]);

    expect(agregado.corridas).toBe(3);
    expect(agregado.completas).toBe(1);
    expect(agregado.criterios).toEqual([
      { criterio: 'a', ok: 2, total: 3, detalle: 'falló a' },
      { criterio: 'b', ok: 1, total: 3, detalle: 'falló b' },
    ]);
    // Para depurar, se muestra lo que envió la primera corrida que falló.
    expect(agregado.enviadoEnFallo).toBe('primera que falla');
  });

  it('un criterio que aparece en algunas corridas cuenta solo esas', () => {
    // "el turno termina sin error" solo existe en la corrida que se cayó.
    const agregado = agregarCorridas([
      corrida([{ criterio: 'a', ok: true }]),
      corrida([
        { criterio: 'el turno termina sin error', ok: false, detalle: '429' },
        { criterio: 'a', ok: false },
      ]),
    ]);

    expect(agregado.criterios).toEqual([
      { criterio: 'a', ok: 1, total: 2 },
      {
        criterio: 'el turno termina sin error',
        ok: 0,
        total: 1,
        detalle: '429',
      },
    ]);
  });

  it('si todas las corridas pasan no hay ejemplo de fallo', () => {
    const agregado = agregarCorridas([corrida([{ criterio: 'a', ok: true }])]);

    expect(agregado.completas).toBe(1);
    expect(agregado.enviadoEnFallo).toBeUndefined();
    expect(agregado.accionesEnFallo).toBeUndefined();
  });

  it('muestra qué herramientas usó la primera corrida que falló, con el motivo si escaló', () => {
    // Sin esto, "escaló y no envió nada" no dice POR QUÉ escaló.
    const agregado = agregarCorridas([
      corrida([{ criterio: 'a', ok: true }]),
      corrida([{ criterio: 'a', ok: false }], '', [
        { tool: 'consultarDato', input: { clave: 'pedido' } },
        { tool: 'escalarAHumano', input: { motivo: 'pedido incompleto' } },
      ]),
    ]);

    expect(agregado.accionesEnFallo).toBe(
      'consultarDato, escalarAHumano (motivo: pedido incompleto)',
    );
  });

  it('dice "ninguna" si la corrida que falló no usó herramientas', () => {
    const agregado = agregarCorridas([corrida([{ criterio: 'a', ok: false }])]);

    expect(agregado.accionesEnFallo).toBe('(ninguna)');
  });

  it('muestra los candidatos de la recuperación de la corrida que falló', () => {
    const fallo = corrida([{ criterio: 'a', ok: false }]);
    fallo.run.recuerdos = ['· 0.290 Cliente: la encargada es Marcela'];

    expect(agregarCorridas([fallo]).recuerdosEnFallo).toEqual([
      '· 0.290 Cliente: la encargada es Marcela',
    ]);
    expect(
      agregarCorridas([corrida([{ criterio: 'a', ok: false }])])
        .recuerdosEnFallo,
    ).toBeUndefined();
  });

  it('muestra lo que anotó la extracción de fondo en la corrida que falló', () => {
    const fallo = corrida([{ criterio: 'a', ok: false }]);
    fallo.run.hechosExtraidos = ['quien_decide: su socia'];
    const vacia = corrida([{ criterio: 'a', ok: false }]);
    vacia.run.hechosExtraidos = [];

    expect(agregarCorridas([fallo]).hechosEnFallo).toBe(
      'quien_decide: su socia',
    );
    expect(agregarCorridas([vacia]).hechosEnFallo).toBe('(ninguno)');
    // Un caso sin extracción no muestra la línea.
    expect(
      agregarCorridas([corrida([{ criterio: 'a', ok: false }])]).hechosEnFallo,
    ).toBeUndefined();
  });
});
