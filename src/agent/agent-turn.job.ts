/** Payload del job de turno del agente encolado en BullMQ. */
export interface AgentTurnJobData {
  companyId: string;
  leadId: string;
  correlationId: string;
  /**
   * Instante (ms) del mensaje entrante que originó este turno. Si al ejecutarse
   * hay un mensaje del mismo lead MÁS nuevo que este, el turno se omite: el job
   * de ese mensaje responderá al bloque completo de una sola vez. Así una
   * ráfaga ("hola" / "quiero info" / "del plan pro") se contesta con un único
   * mensaje en vez de tres. Sin definir = turno que no nace de un mensaje
   * (derivación, seguimiento): nunca se omite.
   */
  inboundAt?: number;
  /** Veces que el job se reprogramó porque el lead tenía un turno en curso. */
  retries?: number;
}
