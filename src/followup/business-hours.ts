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

/** Devuelve `tz` si es una zona válida; si no, la de la empresa por defecto. */
export function safeTimezone(tz: string): string {
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

/**
 * Fecha y hora local legible en la zona horaria dada (para el prompt).
 * El AÑO es obligatorio: sin él, el modelo lo completa con el de su
 * entrenamiento y agenda citas en el año equivocado.
 */
export function formatLocalDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: safeTimezone(timezone),
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** `YYYY-MM-DD` con hora opcional y zona opcional. */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

/** ¿El texto ISO trae zona horaria explícita (`Z` o `±HH:MM`)? */
export function hasTimezoneDesignator(iso: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim());
}

/** Desfase de `timeZone` respecto a UTC en ese instante, en milisegundos. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timeZone),
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Interpreta una fecha/hora ISO en la zona horaria dada. Si el texto ya trae
 * zona (`Z` o `±HH:MM`) se respeta; si no, se ancla a `timeZone` en vez de a la
 * zona del servidor — que en producción es UTC y desplazaba las citas varias
 * horas. Devuelve `null` si el texto no es una fecha válida.
 */
export function parseInZone(iso: string, timeZone: string): Date | null {
  const text = iso.trim();
  // El parser de `Date` es demasiado permisivo ("mañana a las 12" le devuelve
  // una fecha del año 2001), así que primero se exige la forma ISO.
  if (!ISO_DATE_TIME.test(text)) {
    return null;
  }
  if (hasTimezoneDesignator(text)) {
    const explicit = new Date(text);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }

  const naive = new Date(`${text}Z`);
  if (Number.isNaN(naive.getTime())) {
    return null;
  }
  // Dos pasadas: la segunda corrige los saltos de horario de verano, donde el
  // desfase del instante estimado difiere del desfase real de la hora pedida.
  const first = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  return new Date(naive.getTime() - zoneOffsetMs(first, timeZone));
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
 * `extra` agrega una condición más (p. ej. el horario legal de cobranza), que
 * se exige junto con el horario hábil. Si no encuentra ventana en 8 días,
 * devuelve `from + 1h` (evita bucle infinito).
 */
export function nextAllowedTime(
  config: unknown,
  timezone: string,
  from: Date,
  extra?: (date: Date) => boolean,
): Date {
  return firstAllowedAfter(
    from,
    (d) => isWithinBusinessHours(config, timezone, d) && (!extra || extra(d)),
  );
}

/**
 * El primer instante desde `from` (incluido) que cumple `allowed`. A diferencia
 * de `nextAllowedTime`, si `from` ya sirve lo devuelve tal cual: se usa para
 * "no antes de X", donde X puede ser justo un momento válido.
 */
export function earliestAllowedTime(
  from: Date,
  allowed: (date: Date) => boolean,
): Date {
  return allowed(from) ? from : firstAllowedAfter(from, allowed);
}

function firstAllowedAfter(from: Date, allowed: (date: Date) => boolean): Date {
  let candidate = from.getTime();
  for (let i = 0; i < MAX_STEPS; i++) {
    candidate += STEP_MS;
    const d = new Date(candidate);
    if (allowed(d)) {
      return d;
    }
  }
  return new Date(from.getTime() + 60 * 60 * 1000);
}

// ───────────── Horario legal de cobranza (Ley 19.496, art. 37) ─────────────

/**
 * Tramo en que la ley permite gestiones de cobranza: días hábiles del art. 59
 * del Código de Procedimiento Civil, de 8:00 a 20:00. Es un piso: la empresa
 * puede ser más estricta con su horario, nunca más amplia.
 */
const COBRANZA_INICIO_MIN = 8 * 60;
const COBRANZA_FIN_MIN = 20 * 60;

/**
 * Feriados nacionales de Chile, por año. Fuentes: feriados.cl y
 * feriados-chile.cl, contrastadas con las leyes de traslado (Ley 19.668: el
 * 29 de junio y el 12 de octubre pasan al lunes; Ley 20.983: el 17 de
 * septiembre es feriado si el 18 y 19 caen sábado y domingo). No incluye los
 * regionales (Arica, Chillán). Hay que agregar cada año nuevo: un test falla
 * cuando el año en curso no está.
 */
const FERIADOS_CHILE: Record<number, readonly string[]> = {
  2026: [
    '01-01', // Año Nuevo
    '04-03', // Viernes Santo
    '04-04', // Sábado Santo
    '05-01', // Día del Trabajo
    '05-21', // Glorias Navales
    '06-21', // Pueblos Indígenas
    '06-29', // San Pedro y San Pablo
    '07-16', // Virgen del Carmen
    '08-15', // Asunción de la Virgen
    '09-18', // Independencia Nacional
    '09-19', // Glorias del Ejército
    '10-12', // Encuentro de Dos Mundos
    '10-31', // Iglesias Evangélicas y Protestantes
    '11-01', // Todos los Santos
    '12-08', // Inmaculada Concepción
    '12-25', // Navidad
  ],
  2027: [
    '01-01', // Año Nuevo
    '03-26', // Viernes Santo
    '03-27', // Sábado Santo
    '05-01', // Día del Trabajo
    '05-21', // Glorias Navales
    '06-21', // Pueblos Indígenas
    '06-28', // San Pedro y San Pablo (trasladado desde el martes 29)
    '07-16', // Virgen del Carmen
    '08-15', // Asunción de la Virgen
    '09-17', // Feriado adicional de Fiestas Patrias (Ley 20.983)
    '09-18', // Independencia Nacional
    '09-19', // Glorias del Ejército
    '10-11', // Encuentro de Dos Mundos (trasladado desde el martes 12)
    '10-31', // Iglesias Evangélicas y Protestantes
    '11-01', // Todos los Santos
    '12-08', // Inmaculada Concepción
    '12-25', // Navidad
  ],
};

/**
 * Feriados de fecha fija, que valen cualquier año. Si el año no está en la
 * lista de arriba, al menos estos se respetan (los que se trasladan o dependen
 * de la Pascua no se pueden deducir sin el calendario del año).
 */
const FERIADOS_FIJOS_CHILE: readonly string[] = [
  '01-01',
  '05-01',
  '05-21',
  '07-16',
  '08-15',
  '09-18',
  '09-19',
  '11-01',
  '12-08',
  '12-25',
];

/** ¿Hay calendario de feriados cargado para ese año? */
export function hasHolidayCalendar(year: number): boolean {
  return year in FERIADOS_CHILE;
}

/** Fecha local (`YYYY-MM-DD`) de un instante en la zona horaria dada. */
function localIsoDate(date: Date, timezone: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** ¿Esa fecha local (`YYYY-MM-DD`) es feriado nacional en Chile? */
export function isChileanHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  const monthDay = isoDate.slice(5, 10);
  return (FERIADOS_CHILE[year] ?? FERIADOS_FIJOS_CHILE).includes(monthDay);
}

/**
 * ¿Se puede hacer una gestión de cobranza en este instante? Lunes a sábado,
 * sin feriados, de 8:00 a 20:00 en la zona horaria del lead/empresa. No mira
 * el horario de la empresa: se exige además de él, no en su lugar.
 */
export function isLegalCollectionTime(date: Date, timezone: string): boolean {
  const { weekday, minutes } = localParts(date, timezone);
  if (weekday === 'sun' || isChileanHoliday(localIsoDate(date, timezone))) {
    return false;
  }
  return minutes >= COBRANZA_INICIO_MIN && minutes < COBRANZA_FIN_MIN;
}

const WEEKDAY_OFFSET_FROM_MONDAY: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

/**
 * Inicio (lunes 00:00 local) de la semana calendario de `date`, o de una
 * semana posterior con `weeksAhead`. Los topes semanales de cobranza se
 * cuentan por semana calendario, no por los últimos 7 días.
 */
export function startOfCalendarWeek(
  date: Date,
  timezone: string,
  weeksAhead = 0,
): Date {
  const [y, m, d] = localIsoDate(date, timezone).split('-').map(Number);
  const offset = WEEKDAY_OFFSET_FROM_MONDAY[localParts(date, timezone).weekday];
  // Aritmética de calendario en UTC (sin horario de verano); la hora local se
  // resuelve después con parseInZone.
  const monday = new Date(Date.UTC(y, m - 1, d - offset + 7 * weeksAhead));
  const iso = monday.toISOString().slice(0, 10);
  return parseInZone(`${iso}T00:00:00`, timezone) as Date;
}
