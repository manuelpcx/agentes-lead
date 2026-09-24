import {
  earliestAllowedTime,
  formatLocalDateTime,
  hasHolidayCalendar,
  isChileanHoliday,
  isLegalCollectionTime,
  isWithinBusinessHours,
  nextAllowedTime,
  nextLocalTime,
  parseInZone,
  startOfCalendarWeek,
} from './business-hours';

describe('formatLocalDateTime', () => {
  it('incluye el año — sin él el modelo lo inventa y agenda en otro año', () => {
    const texto = formatLocalDateTime(
      new Date('2026-09-16T14:32:00Z'),
      'America/Santiago',
    );
    expect(texto).toContain('2026');
    expect(texto).toContain('septiembre');
  });
});

describe('parseInZone', () => {
  it('ancla una hora sin zona a la zona del cliente, no a la del servidor', () => {
    // 12:00 en Ciudad de México (UTC-6) = 18:00 UTC.
    const d = parseInZone('2026-09-17T12:00:00', 'America/Mexico_City');
    expect(d?.toISOString()).toBe('2026-09-17T18:00:00.000Z');
  });

  it('respeta la zona explícita si viene en el texto', () => {
    const d = parseInZone('2026-09-17T12:00:00Z', 'America/Mexico_City');
    expect(d?.toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });

  it('respeta un offset explícito', () => {
    const d = parseInZone('2026-09-17T12:00:00-03:00', 'America/Mexico_City');
    expect(d?.toISOString()).toBe('2026-09-17T15:00:00.000Z');
  });

  it('devuelve null si el texto no es una fecha', () => {
    expect(parseInZone('mañana a las 12', 'America/Santiago')).toBeNull();
    expect(parseInZone('', 'America/Santiago')).toBeNull();
  });
});

describe('nextLocalTime', () => {
  const tz = 'America/Santiago';

  it('rechaza formatos inválidos', () => {
    const from = new Date('2026-09-01T12:00:00Z');
    expect(nextLocalTime(from, tz, '16')).toBeNull();
    expect(nextLocalTime(from, tz, '25:00')).toBeNull();
    expect(nextLocalTime(from, tz, 'tarde')).toBeNull();
  });

  it('devuelve la próxima ocurrencia de la hora local (hoy si aún no pasa)', () => {
    // 12:00Z ≈ 08:00 en Santiago (UTC-4). Las 16:00 locales aún no pasan → hoy.
    const from = new Date('2026-09-01T12:00:00Z');
    const at = nextLocalTime(from, tz, '16:00');
    expect(at).not.toBeNull();
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at as Date);
    expect(local).toBe('16:00');
    // Debe caer dentro de las próximas 24h y en el futuro.
    const diff = (at as Date).getTime() - from.getTime();
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('si la hora ya pasó hoy, agenda para mañana', () => {
    // 12:00Z ≈ 08:00 en Santiago. Las 07:00 locales ya pasaron → +~23h.
    const from = new Date('2026-09-01T12:00:00Z');
    const at = nextLocalTime(from, tz, '07:00') as Date;
    const diff = at.getTime() - from.getTime();
    expect(diff).toBeGreaterThan(12 * 60 * 60 * 1000);
  });
});

const ALL_DAYS_9_18 = {
  days: {
    mon: [{ start: '09:00', end: '18:00' }],
    tue: [{ start: '09:00', end: '18:00' }],
    wed: [{ start: '09:00', end: '18:00' }],
    thu: [{ start: '09:00', end: '18:00' }],
    fri: [{ start: '09:00', end: '18:00' }],
    sat: [{ start: '09:00', end: '18:00' }],
    sun: [{ start: '09:00', end: '18:00' }],
  },
};

function utcAtWeekday(targetDay: number, hour: number): Date {
  const d = new Date(Date.UTC(2026, 7, 1, hour, 0, 0));
  while (d.getUTCDay() !== targetDay) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

describe('isWithinBusinessHours', () => {
  it('dentro de la ventana configurada → true', () => {
    const d = new Date(Date.UTC(2026, 7, 11, 14, 0, 0));
    expect(isWithinBusinessHours(ALL_DAYS_9_18, 'UTC', d)).toBe(true);
  });

  it('antes de abrir → false', () => {
    const d = new Date(Date.UTC(2026, 7, 11, 7, 0, 0));
    expect(isWithinBusinessHours(ALL_DAYS_9_18, 'UTC', d)).toBe(false);
  });

  it('después de cerrar → false', () => {
    const d = new Date(Date.UTC(2026, 7, 11, 18, 30, 0));
    expect(isWithinBusinessHours(ALL_DAYS_9_18, 'UTC', d)).toBe(false);
  });

  it('default (sin config): domingo cerrado, día hábil abierto al mediodía', () => {
    expect(isWithinBusinessHours(undefined, 'UTC', utcAtWeekday(0, 14))).toBe(
      false,
    );
    expect(isWithinBusinessHours(undefined, 'UTC', utcAtWeekday(1, 14))).toBe(
      true,
    );
  });

  it('respeta la zona horaria', () => {
    // 12:00 UTC = 08:00 en Santiago (UTC-4): fuera de 09:00–18:00.
    const d = new Date(Date.UTC(2026, 7, 11, 12, 0, 0));
    expect(isWithinBusinessHours(ALL_DAYS_9_18, 'America/Santiago', d)).toBe(
      false,
    );
  });
});

describe('nextAllowedTime', () => {
  it('devuelve un instante futuro dentro del horario', () => {
    const from = new Date(Date.UTC(2026, 7, 11, 7, 0, 0)); // antes de abrir
    const next = nextAllowedTime(ALL_DAYS_9_18, 'UTC', from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(isWithinBusinessHours(ALL_DAYS_9_18, 'UTC', next)).toBe(true);
  });
});

const OPEN_24_7 = {
  days: {
    mon: [{ start: '00:00', end: '23:59' }],
    tue: [{ start: '00:00', end: '23:59' }],
    wed: [{ start: '00:00', end: '23:59' }],
    thu: [{ start: '00:00', end: '23:59' }],
    fri: [{ start: '00:00', end: '23:59' }],
    sat: [{ start: '00:00', end: '23:59' }],
    sun: [{ start: '00:00', end: '23:59' }],
  },
};

describe('isLegalCollectionTime (Ley 19.496, art. 37)', () => {
  // Miércoles 23 de septiembre de 2026: día hábil común.
  it('permite de 8:00 a 20:00 (20:00 ya no)', () => {
    expect(isLegalCollectionTime(new Date('2026-09-23T07:59:00Z'), 'UTC')).toBe(
      false,
    );
    expect(isLegalCollectionTime(new Date('2026-09-23T08:00:00Z'), 'UTC')).toBe(
      true,
    );
    expect(isLegalCollectionTime(new Date('2026-09-23T19:59:00Z'), 'UTC')).toBe(
      true,
    );
    expect(isLegalCollectionTime(new Date('2026-09-23T20:00:00Z'), 'UTC')).toBe(
      false,
    );
  });

  it('el sábado se puede, el domingo no', () => {
    expect(isLegalCollectionTime(new Date('2026-09-26T12:00:00Z'), 'UTC')).toBe(
      true,
    );
    expect(isLegalCollectionTime(new Date('2026-09-27T12:00:00Z'), 'UTC')).toBe(
      false,
    );
  });

  it('los feriados no son hábiles, aunque caigan lunes a sábado', () => {
    // Lunes 12 de octubre de 2026 (Encuentro de Dos Mundos) y viernes 18 de
    // septiembre de 2026 (Independencia).
    expect(isLegalCollectionTime(new Date('2026-10-12T12:00:00Z'), 'UTC')).toBe(
      false,
    );
    expect(isLegalCollectionTime(new Date('2026-09-18T12:00:00Z'), 'UTC')).toBe(
      false,
    );
  });

  it('se mide en la hora del lead, no en la del servidor', () => {
    // 10:30 UTC = 07:30 en Santiago (UTC-3 en septiembre): aún no se puede.
    const d = new Date('2026-09-23T10:30:00Z');
    expect(isLegalCollectionTime(d, 'UTC')).toBe(true);
    expect(isLegalCollectionTime(d, 'America/Santiago')).toBe(false);
  });
});

describe('feriados de Chile', () => {
  it('hay calendario cargado para el año en curso (agregar el año nuevo si falla)', () => {
    expect(hasHolidayCalendar(new Date().getFullYear())).toBe(true);
  });

  it('aplica los traslados del año (Ley 19.668 y Ley 20.983)', () => {
    expect(isChileanHoliday('2027-06-28')).toBe(true); // San Pedro, al lunes
    expect(isChileanHoliday('2027-06-29')).toBe(false);
    expect(isChileanHoliday('2027-09-17')).toBe(true); // 18 y 19 en fin de semana
  });

  it('en un año sin calendario respeta al menos los de fecha fija', () => {
    expect(isChileanHoliday('2031-09-18')).toBe(true);
    expect(isChileanHoliday('2031-12-25')).toBe(true);
    expect(isChileanHoliday('2031-09-23')).toBe(false);
  });
});

describe('startOfCalendarWeek', () => {
  it('devuelve el lunes 00:00 de la semana', () => {
    expect(
      startOfCalendarWeek(
        new Date('2026-09-23T15:00:00Z'),
        'UTC',
      ).toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z');
  });

  it('el domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(
      startOfCalendarWeek(
        new Date('2026-09-27T12:00:00Z'),
        'UTC',
      ).toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z');
  });

  it('con weeksAhead devuelve el lunes siguiente', () => {
    expect(
      startOfCalendarWeek(
        new Date('2026-09-23T15:00:00Z'),
        'UTC',
        1,
      ).toISOString(),
    ).toBe('2026-09-28T00:00:00.000Z');
  });

  it('usa el calendario local del lead', () => {
    // 02:00 UTC del lunes 21 = domingo 20 a las 23:00 en Santiago: todavía es
    // la semana del lunes 14 (00:00 local = 03:00 UTC).
    expect(
      startOfCalendarWeek(
        new Date('2026-09-21T02:00:00Z'),
        'America/Santiago',
      ).toISOString(),
    ).toBe('2026-09-14T03:00:00.000Z');
  });
});

describe('earliestAllowedTime', () => {
  const legal = (d: Date) => isLegalCollectionTime(d, 'UTC');

  it('si el instante ya sirve, lo devuelve tal cual', () => {
    const d = new Date('2026-09-23T10:00:00Z');
    expect(earliestAllowedTime(d, legal)).toBe(d);
  });

  it('si no, avanza al primer instante permitido', () => {
    expect(
      earliestAllowedTime(
        new Date('2026-09-23T21:00:00Z'),
        legal,
      ).toISOString(),
    ).toBe('2026-09-24T08:00:00.000Z');
  });
});

describe('nextAllowedTime con horario legal de cobranza', () => {
  it('el horario legal manda aunque la empresa atienda 24/7 y domingos', () => {
    // Sábado 26 a las 20:00: el domingo no se puede → lunes 28 a las 8:00.
    const next = nextAllowedTime(
      OPEN_24_7,
      'UTC',
      new Date('2026-09-26T20:00:00Z'),
      (d) => isLegalCollectionTime(d, 'UTC'),
    );
    expect(next.toISOString()).toBe('2026-09-28T08:00:00.000Z');
  });
});
