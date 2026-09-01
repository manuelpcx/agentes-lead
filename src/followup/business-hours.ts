/** Días de la semana (claves de configuración de horario). */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Ventana horaria "HH:MM"-"HH:MM". */
export interface DayWindow {
  start: string;
  end: string;
}

/** Configuración de horario hábil. Formato esperado en Company.businessHours. */
export interface BusinessHoursConfig {
  days?: Partial<Record<Weekday, DayWindow[]>>;
}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Horario por defecto si la empresa no configuró uno: L-S 09:00–20:00. */
const DEFAULT_WINDOWS: Record<Weekday, DayWindow[]> = {
  mon: [{ start: '09:00', end: '20:00' }],
  tue: [{ start: '09:00', end: '20:00' }],
  wed: [{ start: '09:00', end: '20:00' }],
  thu: [{ start: '09:00', end: '20:00' }],
  fri: [{ start: '09:00', end: '20:00' }],
  sat: [{ start: '09:00', end: '20:00' }],
  sun: [],
};

const STEP_MS = 30 * 60 * 1000;
const MAX_STEPS = 8 * 48; // hasta 8 días buscando la próxima ventana

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Resuelve las ventanas por día desde la config (o el default). */
function resolveWindows(config: unknown): Record<Weekday, DayWindow[]> {
  const days =
    config && typeof config === 'object' && 'days' in config
      ? (config as BusinessHoursConfig).days
      : undefined;
  if (!days) {
    return DEFAULT_WINDOWS;
  }
  const result = { ...DEFAULT_WINDOWS };
  for (const day of WEEKDAYS) {
    const windows = days[day];
    if (Array.isArray(windows)) {
      result[day] = windows;
    }
  }
  return result;
}

/** Devuelve {weekday, minutes} locales a la zona horaria dada. */
function localParts(
  date: Date,
  timezone: string,
): {
  weekday: Weekday;
  minutes: number;
} {
  const tz = safeTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const map: Record<string, Weekday> = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  };
  const weekday = map[get('weekday')] ?? 'mon';
  const hour = Number(get('hour')) % 24; // "24" a medianoche en algunos runtimes
  const minutes = hour * 60 + Number(get('minute'));
  return { weekday, minutes };
}

function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Santiago';
  }
}

/**
 * Próxima ocurrencia de una hora local "HH:MM" a partir de `from`, en la zona
 * horaria dada. Si la hora ya pasó hoy, devuelve la de mañana. Sirve para
 * agendar callbacks por hora absoluta ("llámame a las 16:00") sin que el modelo
 * tenga que calcular minutos. Devuelve null si el formato no es válido.
 */
export function nextLocalTime(
  from: Date,
  timezone: string,
  hhmm: string,
): Date | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm.trim())) {
    return null;
  }
  const target = toMinutes(hhmm.trim());
  if (target < 0 || target >= 24 * 60) {
    return null;
  }
  const current = localParts(from, timezone).minutes;
  let delta = target - current;
  if (delta <= 0) {
    delta += 24 * 60; // ya pasó hoy → mañana
  }
  return new Date(from.getTime() + delta * 60 * 1000);
}

/** Fecha y hora local legible en la zona horaria dada (para el prompt). */
export function formatLocalDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: safeTimezone(timezone),
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** ¿`date` cae dentro del horario hábil (en la zona horaria dada)? */
export function isWithinBusinessHours(
  config: unknown,
  timezone: string,
  date: Date,
): boolean {
  const windows = resolveWindows(config);
  const { weekday, minutes } = localParts(date, timezone);
  return (windows[weekday] ?? []).some(
    (w) => minutes >= toMinutes(w.start) && minutes < toMinutes(w.end),
  );
}

/**
 * Próximo instante permitido a partir de `from` (avanzando en pasos de 30 min).
 * Si no encuentra ventana en 8 días, devuelve `from + 1h` (evita bucle infinito).
 */
export function nextAllowedTime(
  config: unknown,
  timezone: string,
  from: Date,
): Date {
  let candidate = from.getTime();
  for (let i = 0; i < MAX_STEPS; i++) {
    candidate += STEP_MS;
    const d = new Date(candidate);
    if (isWithinBusinessHours(config, timezone, d)) {
      return d;
    }
  }
  return new Date(from.getTime() + 60 * 60 * 1000);
}
