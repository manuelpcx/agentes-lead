import { isWithinBusinessHours, nextAllowedTime } from './business-hours';

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
