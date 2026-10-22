import {
  Compromiso,
  HISTORIAL_DIAS,
  MAX_COMPROMISOS,
  agregarCompromiso,
  calcularVencimiento,
  fechaLocal,
  formatCompromisos,
  parseCompromisos,
  proximoPendiente,
  resolverCompromiso,
  vencidoPendiente,
} from './commitments';

const TZ = 'America/Santiago';
// Martes 20 de octubre de 2026, 15:00 en Santiago (UTC-3).
const AHORA = new Date('2026-10-20T18:00:00Z');

function venceEn(fecha: string): Date {
  const r = calcularVencimiento(fecha, TZ, AHORA);
  if ('error' in r) throw new Error(r.error);
  return r.venceEn;
}

function compromiso(over: Partial<Compromiso>): Compromiso {
  return {
    id: 'c1',
    tipo: 'pago',
    texto: 'paga la cuota de octubre',
    fecha: '2026-10-24',
    venceEn: '2026-10-24T13:00:00.000Z',
    estado: 'pendiente',
    creadoEn: '2026-10-20T18:00:00.000Z',
    ...over,
  };
}

describe('calcularVencimiento', () => {
  it('retoma a las 10:00 del día acordado, en la zona del lead', () => {
    // 10:00 en Santiago (UTC-3) = 13:00 UTC, no medianoche UTC.
    expect(venceEn('2026-10-24').toISOString()).toBe(
      '2026-10-24T13:00:00.000Z',
    );
  });

  it('"te pago hoy" se verifica mañana, no minutos después', () => {
    expect(venceEn('2026-10-20').toISOString()).toBe(
      '2026-10-21T13:00:00.000Z',
    );
  });

  it('rechaza una fecha pasada o mal escrita', () => {
    expect(calcularVencimiento('2026-10-19', TZ, AHORA)).toEqual({
      error: expect.stringContaining('ya pasó'),
    });
    expect(calcularVencimiento('el viernes', TZ, AHORA)).toEqual({
      error: expect.stringContaining('YYYY-MM-DD'),
    });
  });

  it('el "hoy" es el de la zona del lead, no el del servidor', () => {
    // 22:00 en Santiago = 01:00 UTC del día siguiente.
    const noche = new Date('2026-10-21T01:00:00Z');
    expect(fechaLocal(noche, TZ)).toBe('2026-10-20');
    expect(calcularVencimiento('2026-10-20', TZ, noche)).not.toHaveProperty(
      'error',
    );
  });
});

describe('calcularVencimiento — con hora', () => {
  it('respeta la hora pedida, en la zona del lead', () => {
    // 10:00 en Santiago (UTC-3) = 13:00 UTC.
    const r = calcularVencimiento('2026-10-21', TZ, AHORA, '10:00');
    expect(r).toEqual({ venceEn: new Date('2026-10-21T13:00:00.000Z') });
  });

  it('acepta hoy si la hora todavía no pasa', () => {
    // AHORA = 15:00 en Santiago.
    const r = calcularVencimiento('2026-10-20', TZ, AHORA, '17:30');
    expect(r).toEqual({ venceEn: new Date('2026-10-20T20:30:00.000Z') });
  });

  it('rechaza una hora de hoy que ya pasó', () => {
    expect(calcularVencimiento('2026-10-20', TZ, AHORA, '09:00')).toEqual({
      error: expect.stringContaining('ya pasó'),
    });
  });

  it('rechaza una hora mal escrita', () => {
    expect(calcularVencimiento('2026-10-21', TZ, AHORA, '10am')).toEqual({
      error: expect.stringContaining('HH:MM'),
    });
  });
});

describe('agregarCompromiso', () => {
  it('le da un id corto y lo deja pendiente', () => {
    const { lista, compromiso: c } = agregarCompromiso(
      [],
      {
        tipo: 'pago',
        texto: 'paga  la cuota ',
        fecha: '2026-10-24',
        venceEn: venceEn('2026-10-24'),
      },
      AHORA,
    );

    expect(c).toMatchObject({
      id: 'c1',
      texto: 'paga la cuota',
      estado: 'pendiente',
    });
    expect(lista).toEqual([c]);
  });

  it('una fecha nueva antes de la anterior la deja cancelada (reprogramó)', () => {
    const { lista, reemplazados } = agregarCompromiso(
      [compromiso({})],
      {
        tipo: 'pago',
        texto: 'paga el 30',
        fecha: '2026-10-30',
        venceEn: venceEn('2026-10-30'),
      },
      AHORA,
    );

    expect(reemplazados).toEqual([
      expect.objectContaining({ id: 'c1', estado: 'cancelado' }),
    ]);
    expect(lista.map((c) => [c.id, c.estado])).toEqual([
      ['c1', 'cancelado'],
      ['c2', 'pendiente'],
    ]);
  });

  it('una fecha nueva después de vencida la anterior la deja incumplida', () => {
    const { reemplazados } = agregarCompromiso(
      [
        compromiso({
          fecha: '2026-10-15',
          venceEn: '2026-10-15T13:00:00.000Z',
        }),
      ],
      {
        tipo: 'pago',
        texto: 'paga el 30',
        fecha: '2026-10-30',
        venceEn: venceEn('2026-10-30'),
      },
      AHORA,
    );

    expect(reemplazados[0].estado).toBe('incumplido');
  });

  it('un recontacto no toca la promesa de pago', () => {
    const { lista } = agregarCompromiso(
      [compromiso({})],
      {
        tipo: 'recontacto',
        texto: 'pidió que le escriban después del 15',
        fecha: '2026-11-16',
        venceEn: venceEn('2026-11-16'),
      },
      AHORA,
    );

    expect(lista.map((c) => c.estado)).toEqual(['pendiente', 'pendiente']);
  });

  it(`pasado el tope de ${MAX_COMPROMISOS} olvida resueltos, nunca pendientes`, () => {
    const viejos = Array.from({ length: MAX_COMPROMISOS }, (_, i) =>
      compromiso({
        id: `c${i + 1}`,
        tipo: 'recontacto',
        estado: i === 0 ? 'pendiente' : 'cumplido',
        resueltoEn: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );

    const { lista } = agregarCompromiso(
      viejos,
      {
        tipo: 'pago',
        texto: 'x',
        fecha: '2026-10-30',
        venceEn: venceEn('2026-10-30'),
      },
      AHORA,
    );

    expect(lista).toHaveLength(MAX_COMPROMISOS);
    // Se fue el resuelto más viejo (c2); el pendiente c1 sigue.
    expect(lista.map((c) => c.id)).not.toContain('c2');
    expect(lista.map((c) => c.id)).toContain('c1');
  });
});

describe('resolverCompromiso', () => {
  it('marca el estado y cuándo se resolvió', () => {
    const r = resolverCompromiso([compromiso({})], 'c1', 'cumplido', AHORA);

    expect(r?.compromiso).toMatchObject({
      estado: 'cumplido',
      resueltoEn: AHORA.toISOString(),
    });
  });

  it('null si el id no existe', () => {
    expect(resolverCompromiso([compromiso({})], 'c9', 'cumplido')).toBeNull();
  });
});

describe('proximoPendiente / vencidoPendiente', () => {
  const lista = [
    compromiso({ id: 'c1', venceEn: '2026-10-15T13:00:00.000Z' }),
    compromiso({ id: 'c2', venceEn: '2026-11-02T13:00:00.000Z' }),
    compromiso({ id: 'c3', venceEn: '2026-10-24T13:00:00.000Z' }),
    compromiso({
      id: 'c4',
      venceEn: '2026-10-21T13:00:00.000Z',
      estado: 'cumplido',
    }),
  ];

  it('el próximo es el pendiente futuro más cercano', () => {
    expect(proximoPendiente(lista, AHORA)?.id).toBe('c3');
  });

  it('el vencido es el pendiente pasado más antiguo', () => {
    expect(vencidoPendiente(lista, AHORA)?.id).toBe('c1');
  });

  it('sin pendientes, null', () => {
    expect(proximoPendiente([], AHORA)).toBeNull();
    expect(vencidoPendiente([], AHORA)).toBeNull();
  });
});

describe('formatCompromisos', () => {
  it('lo futuro como pendiente, con su id y la fecha legible', () => {
    const out = formatCompromisos([compromiso({})], TZ, AHORA);

    expect(out).toContain('[c1] Pago: "paga la cuota de octubre"');
    expect(out).toContain('para el sábado, 24 de octubre. Pendiente.');
    expect(out).toContain('hoy es martes, 20 de octubre');
  });

  it('si tiene hora, la muestra', () => {
    const out = formatCompromisos(
      [compromiso({ tipo: 'recontacto', texto: 'ver el plan', hora: '10:00' })],
      TZ,
      AHORA,
    );

    expect(out).toContain('para el sábado, 24 de octubre a las 10:00.');
  });

  it('lo vencido sin confirmar, como algo a verificar y no como vigente', () => {
    const out = formatCompromisos(
      [compromiso({ fecha: '2026-10-15', venceEn: '2026-10-15T13:00:00Z' })],
      TZ,
      AHORA,
    );

    expect(out).toContain('era para el jueves, 15 de octubre');
    expect(out).toContain('NO asumas que se cumplió');
    expect(out).not.toContain('Pendiente.');
  });

  it(`lo resuelto se muestra ${HISTORIAL_DIAS} días y después se olvida`, () => {
    const reciente = compromiso({
      estado: 'cumplido',
      resueltoEn: '2026-10-18T00:00:00.000Z',
    });
    const viejo = compromiso({
      id: 'c2',
      texto: 'pago de agosto',
      estado: 'cumplido',
      resueltoEn: '2026-08-01T00:00:00.000Z',
    });

    const out = formatCompromisos([reciente, viejo], TZ, AHORA);

    expect(out).toContain(
      '"paga la cuota de octubre" — del sábado, 24 de octubre: cumplido.',
    );
    expect(out).not.toContain('agosto');
  });

  it('sin nada que mostrar, vacío', () => {
    expect(formatCompromisos([], TZ, AHORA)).toBe('');
  });
});

describe('parseCompromisos', () => {
  it('descarta lo que no calce', () => {
    expect(
      parseCompromisos([
        compromiso({}),
        { id: 'c2', tipo: 'otro' },
        null,
        'x',
        { ...compromiso({ id: 'c3' }), fecha: 'viernes' },
      ]).map((c) => c.id),
    ).toEqual(['c1']);
    expect(parseCompromisos(undefined)).toEqual([]);
  });
});
