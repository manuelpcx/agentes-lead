import { startOfCalendarWeek } from './business-hours';

/**
 * Piso legal de la cobranza extrajudicial (Ley 19.496, art. 37). Aplica a los
 * agentes de tipo COBRANZA y ninguna configuración del agente lo puede saltar:
 *  - mensajería y correo: máximo 2 gestiones proactivas por semana calendario,
 *    con al menos 48 h entre una y otra;
 *  - llamadas: máximo 1 proactiva por semana calendario;
 *  - todo, solo en horario legal (ver `isLegalCollectionTime`).
 * Responder a un mensaje del deudor no es una gestión proactiva: solo cuentan
 * las interacciones salientes etiquetadas con `metadata.gestion`.
 */

/** Valor de `Interaction.metadata.gestion` que marca una gestión proactiva. */
export const GESTION_PROACTIVA = 'proactiva';

export const COBRANZA_MIN_GAP_HOURS = 48;
export const COBRANZA_MAX_MENSAJES_SEMANA = 2;
export const COBRANZA_MAX_LLAMADAS_SEMANA = 1;

const HOUR_MS = 60 * 60 * 1000;
const MIN_GAP_MS = COBRANZA_MIN_GAP_HOURS * HOUR_MS;

/** Canales de mensajería que comparten el tope de 2 por semana. */
const CANALES_MENSAJERIA = new Set(['whatsapp', 'email']);

export type TipoGestion = 'mensajeria' | 'llamada';

/** Una gestión proactiva ya hecha (interacción saliente etiquetada). */
export interface GestionPrevia {
  channel: string;
  occurredAt: Date;
}

export type VeredictoCobranza =
  { allowed: true } | { allowed: false; reason: string; notBefore: Date };

/**
 * Desde cuándo hay que traer gestiones para evaluar el piso: el inicio de la
 * semana calendario o 48 h atrás, lo que sea anterior (un lunes, la gestión
 * del sábado todavía cuenta para el espaciado).
 */
export function collectionWindowStart(now: Date, timezone: string): Date {
  const weekStart = startOfCalendarWeek(now, timezone);
  return new Date(Math.min(weekStart.getTime(), now.getTime() - MIN_GAP_MS));
}

/**
 * ¿Se puede hacer ahora una gestión proactiva de este tipo? Si no, devuelve el
 * motivo y el primer instante en que los topes lo permitirían (sin ajustar al
 * horario: eso lo hace quien reprograma).
 *
 * `lastContactedAt` (último intento de seguimiento del lead) cubre el
 * historial anterior al etiquetado: esas gestiones no tienen la marca, pero el
 * espaciado de 48 h igual se respeta.
 */
export function evaluateCollectionFloor(params: {
  kind: TipoGestion;
  now: Date;
  timezone: string;
  contacts: GestionPrevia[];
  lastContactedAt?: Date | null;
}): VeredictoCobranza {
  const { kind, now, timezone, contacts, lastContactedAt } = params;
  const weekStart = startOfCalendarWeek(now, timezone);
  const nextWeek = startOfCalendarWeek(now, timezone, 1);
  const deEstaSemana = (c: GestionPrevia) =>
    c.occurredAt.getTime() >= weekStart.getTime();

  if (kind === 'llamada') {
    const llamadas = contacts.filter(
      (c) => c.channel === 'call' && deEstaSemana(c),
    );
    if (llamadas.length >= COBRANZA_MAX_LLAMADAS_SEMANA) {
      return {
        allowed: false,
        reason:
          'ya hubo una llamada proactiva esta semana (máximo ' +
          `${COBRANZA_MAX_LLAMADAS_SEMANA} por semana).`,
        notBefore: nextWeek,
      };
    }
    return { allowed: true };
  }

  const mensajes = contacts.filter((c) => CANALES_MENSAJERIA.has(c.channel));
  const motivos: string[] = [];
  let notBefore = 0;

  if (mensajes.filter(deEstaSemana).length >= COBRANZA_MAX_MENSAJES_SEMANA) {
    motivos.push(
      `ya hubo ${COBRANZA_MAX_MENSAJES_SEMANA} gestiones proactivas por ` +
        'mensajería esta semana (máximo por semana).',
    );
    notBefore = nextWeek.getTime();
  }

  const ultima = Math.max(
    0,
    ...mensajes.map((c) => c.occurredAt.getTime()),
    lastContactedAt?.getTime() ?? 0,
  );
  if (ultima > 0 && now.getTime() - ultima < MIN_GAP_MS) {
    motivos.push(
      `la última gestión proactiva fue hace menos de ${COBRANZA_MIN_GAP_HOURS} h.`,
    );
    notBefore = Math.max(notBefore, ultima + MIN_GAP_MS);
  }

  if (motivos.length === 0) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: motivos.join(' Además, '),
    notBefore: new Date(notBefore),
  };
}
