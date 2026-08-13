/** Identificadores de las herramientas del agente (Fase 3). */
export const TOOL_BUSCAR_CONOCIMIENTO = 'buscarConocimiento';
export const TOOL_CONSULTAR_DATO = 'consultarDato';
export const TOOL_ENVIAR_WHATSAPP = 'enviarWhatsApp';
export const TOOL_ACTUALIZAR_ESTADO_LEAD = 'actualizarEstadoLead';
export const TOOL_ESCALAR_A_HUMANO = 'escalarAHumano';
export const TOOL_ENVIAR_CORREO = 'enviarCorreo';
export const TOOL_AGENDAR_CITA = 'agendarCita';
export const TOOL_INICIAR_LLAMADA = 'iniciarLlamada';
/** Traspaso de conversación a otro agente (Fase 8). */
export const TOOL_DERIVAR_A_AGENTE = 'derivarAAgente';

/** Conjunto de herramientas iniciales habilitadas por defecto. */
export const DEFAULT_ENABLED_TOOLS: string[] = [
  TOOL_BUSCAR_CONOCIMIENTO,
  TOOL_CONSULTAR_DATO,
  TOOL_ENVIAR_WHATSAPP,
  TOOL_ACTUALIZAR_ESTADO_LEAD,
  TOOL_ESCALAR_A_HUMANO,
  TOOL_ENVIAR_CORREO,
  TOOL_AGENDAR_CITA,
  TOOL_INICIAR_LLAMADA,
  TOOL_DERIVAR_A_AGENTE,
];
