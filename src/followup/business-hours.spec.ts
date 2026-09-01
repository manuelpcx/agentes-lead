import {
  isWithinBusinessHours,
  nextAllowedTime,
  nextLocalTime,
} from './business-hours';

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
