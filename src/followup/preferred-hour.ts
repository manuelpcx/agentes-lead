import { nextLocalTime, safeTimezone } from './business-hours';

/**
 * Plan por lead (como la planificación de *Generative Agents*, pero con
 * reglas): si una persona suele responder a cierta hora, el seguimiento se
 * corre hacia esa hora. Determinista, sin LLM, y siempre dentro de lo
 * permitido (horario hábil y piso legal de cobranza).
 */

/** Respuestas mínimas para hablar de un hábito. */
export const MIN_RESPUESTAS = 3;
/** Fracción de respuestas que tiene que caer en la franja (hora ± 1). */
const MIN_CONCENTRACION = 0.6;

const HORA = 3_600_000;

function horaLocal(fecha: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: safeTimezone(timezone),
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(fecha),
  );
}

/**
 * La hora local (0–23) en que el lead suele responder: la franja de 3 horas
 * con más respuestas, si concentra al menos el 60 %. Con menos de
 * `MIN_RESPUESTAS` respuestas, o si responde a cualquier hora, `null`.
 */
export function horaHabitual(fechas: Date[], timezone: string): number | null {
  if (fechas.length < MIN_RESPUESTAS) {
    return null;
  }
  const porHora = new Array<number>(24).fill(0);
  for (const f of fechas) {
    porHora[horaLocal(f, timezone)]++;
  }
  let mejor = 0;
  let mejorFranja = -1;
  for (let h = 0; h < 24; h++) {
    const franja = porHora[(h + 23) % 24] + porHora[h] + porHora[(h + 1) % 24];
    if (franja > mejorFranja) {
      mejorFranja = franja;
      mejor = h;
    }
  }
  return mejorFranja / fechas.length >= MIN_CONCENTRACION ? mejor : null;
}

/**
 * Corre `base` (cuándo tocaba el seguimiento) a la ocurrencia de `hora` más
 * cercana, antes o después, si está a no más de `margenHoras`, es futura y
 * está permitida. Si no, devuelve `base` tal cual.
 *
 * `soloHaciaAdelante` es para cobranza: adelantar el seguimiento podría
 * achicar el espaciado legal entre gestiones.
 */
export function alinearConHoraHabitual(
  base: Date,
  hora: number,
  timezone: string,
  ahora: Date,
  permitido: (d: Date) => boolean,
  margenHoras = 12,
  soloHaciaAdelante = false,
): Date {
  const siguiente = nextLocalTime(
    base,
    timezone,
    `${String(hora).padStart(2, '0')}:00`,
  );
  if (!siguiente) {
    return base;
  }
  const candidatos = [new Date(siguiente.getTime() - 24 * HORA), siguiente]
    .filter(
      (c) =>
        c.getTime() > ahora.getTime() &&
        (!soloHaciaAdelante || c.getTime() >= base.getTime()) &&
        Math.abs(c.getTime() - base.getTime()) <= margenHoras * HORA &&
        permitido(c),
    )
    .sort(
      (a, b) =>
        Math.abs(a.getTime() - base.getTime()) -
        Math.abs(b.getTime() - base.getTime()),
    );
  return candidatos[0] ?? base;
}
