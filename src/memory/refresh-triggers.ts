/**
 * Cuándo rehacer la memoria del lead (resumen, hechos y conclusiones). Como el
 * umbral de importancia de *Generative Agents*: no solo cada N mensajes, sino
 * también cuando pasa algo que cambia la relación.
 */

/**
 * Cada cuántos mensajes nuevos se rehace la memoria. Con la ventana de
 * historial en 30 mensajes, refrescar cada 10 significa que nada sale de la
 * ventana sin haber pasado por el resumen al menos una vez.
 */
export const REFRESH_EVERY_INTERACTIONS = 10;
/** Mensajes para el primer resumen de un lead nuevo. */
export const MIN_PRIMER_RESUMEN = 3;
/** Silencio tras el cual una respuesta cuenta como "volvió". */
export const SILENCIO_LARGO_MS = 7 * 24 * 3_600_000;

/** Lo que pasó desde el último refresco. */
export interface SenalesDeRefresco {
  tieneResumen: boolean;
  /** Mensajes de conversación nuevos desde el último refresco. */
  nuevas: number;
  /** Hubo una llamada (su transcripción) desde el último refresco. */
  huboLlamada: boolean;
  /** El agente escaló, registró una promesa de pago o derivó. */
  huboEventoClave: boolean;
  /** El cliente volvió a escribir después de un silencio largo. */
  volvioTrasSilencio: boolean;
}

/**
 * El motivo para rehacer la memoria ahora, o `null` si todavía no hace falta.
 * Sin mensajes nuevos nunca: no habría nada nuevo que resumir.
 */
export function motivoDeRefresco(s: SenalesDeRefresco): string | null {
  if (s.nuevas === 0) {
    return null;
  }
  if (s.nuevas >= REFRESH_EVERY_INTERACTIONS) {
    return 'mensajes';
  }
  if (!s.tieneResumen) {
    return s.nuevas >= MIN_PRIMER_RESUMEN ? 'primer_resumen' : null;
  }
  if (s.huboLlamada) {
    return 'llamada';
  }
  if (s.huboEventoClave) {
    return 'evento';
  }
  if (s.volvioTrasSilencio) {
    return 'regreso';
  }
  return null;
}

/** Lo mínimo de un mensaje para detectar un regreso. */
export interface MarcaDeMensaje {
  direction: string;
  occurredAt: Date;
}

/**
 * ¿Algún mensaje del cliente llegó después de un silencio largo? Recibe los
 * mensajes en orden cronológico: los nuevos más el último ya resumido, para
 * medir también el hueco entre lo viejo y lo primero nuevo.
 */
export function volvioTrasSilencio(
  cronologicos: MarcaDeMensaje[],
  silencioMs = SILENCIO_LARGO_MS,
): boolean {
  for (let i = 1; i < cronologicos.length; i++) {
    const actual = cronologicos[i];
    const hueco =
      actual.occurredAt.getTime() - cronologicos[i - 1].occurredAt.getTime();
    if (actual.direction === 'inbound' && hueco >= silencioMs) {
      return true;
    }
  }
  return false;
}
