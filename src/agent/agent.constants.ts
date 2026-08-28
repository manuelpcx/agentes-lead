/** Mensaje de respaldo cuando el agente no puede operar (sin LLM). */
export const FALLBACK_ESCALATION_MESSAGE =
  'Gracias por tu mensaje. En un momento te contacta una persona del equipo.';

/**
 * `Lead.nextActionType` que marca una llamada de voz agendada por el propio lead
 * (vía el tool iniciarLlamada). El seguimiento la ejecuta forzando canal 'call'
 * y saltándose el guard de "cliente habló último". Compartida entre el tool y
 * el FollowUpService.
 */
export const SCHEDULED_CALL_TYPE = 'llamada_programada';
