import { Channel } from '@prisma/client';

/**
 * Canales que forman la conversación real con el cliente. El canal `system` es
 * la bitácora interna (derivaciones, escalamientos, cierres) y no se le muestra
 * al modelo como parte del diálogo.
 */
export const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

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

/**
 * `Lead.nextActionType` de una promesa de pago (cobranza). El seguimiento la
 * ejecuta el día pactado para verificar el pago, saltándose el guard de
 * "cliente habló último". Compartida entre el tool y el FollowUpService.
 */
export const PROMISE_PAY_TYPE = 'promesa_pago';

/**
 * `Lead.nextActionType` de un recontacto pactado: la persona pidió que le
 * escribieran en una fecha ("escríbeme el lunes"). Igual que la promesa de
 * pago, el seguimiento lo ejecuta ese día saltándose el guard de "cliente
 * habló último". Lo agenda `programarRecontacto`.
 */
export const RECONTACT_TYPE = 'recontacto_pactado';
