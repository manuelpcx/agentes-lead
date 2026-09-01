/** Token de inyección del proveedor de llamadas de voz activo. */
export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');

/** Parámetros para iniciar una llamada saliente. */
export interface StartCallParams {
  /** Número destino del lead en E.164. */
  to: string;
  /**
   * Metadata opaca de correlación (companyId/leadId/motivo). El proveedor la
   * devuelve tal cual en el webhook de fin de llamada.
   */
  metadata: Record<string, unknown>;
  /**
   * Variables dinámicas que el proveedor inyecta en el prompt de SU agente de
   * voz (p. ej. Retell `retell_llm_dynamic_variables`): nombre del lead,
   * empresa, motivo, tono. Todas string. Providers que no las soportan las ignoran.
   */
  dynamicVariables?: Record<string, string>;
  /**
   * Overrides de configuración de voz de la empresa para esta llamada (voz,
   * velocidad, idioma, saludo). El provider los traduce a su formato
   * (Retell: `agent_override`). Providers que no los soportan los ignoran.
   */
  overrides?: {
    voiceId?: string;
    voiceSpeed?: number;
    language?: string;
    beginMessage?: string;
  };
}

/** Contrato de llamadas de voz (salida). */
export interface VoiceProvider {
  /** Inicia una llamada saliente y devuelve el id de la llamada. */
  startCall(params: StartCallParams): Promise<{ callId: string }>;
}
