/** Token de inyección del proveedor de llamadas activo. */
export const VAPI_PROVIDER = Symbol('VAPI_PROVIDER');

/** Parámetros para iniciar una llamada saliente. */
export interface StartCallParams {
  to: string;
  metadata: Record<string, unknown>;
}

/** Contrato de llamadas de voz. */
export interface VapiProvider {
  /** Inicia una llamada y devuelve el id de la llamada. */
  startCall(params: StartCallParams): Promise<{ callId: string }>;
}
