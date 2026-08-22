/** Token de inyección del proveedor de WhatsApp activo. */
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/**
 * Mensaje de plantilla (HSM) de WhatsApp. Es la ÚNICA forma de iniciar
 * conversación fuera de la ventana de 24h (leads que nunca escribieron, o que
 * respondieron hace más de 24h). El texto está pre-aprobado por Meta; solo se
 * rellenan las variables del cuerpo ({{1}}, {{2}}, …) en orden.
 */
export interface WhatsappTemplateMessage {
  /** Nombre de la plantilla aprobada. */
  name: string;
  /** Código de idioma de la plantilla (p. ej. "es", "es_CL"). */
  languageCode: string;
  /** Valores de las variables del cuerpo, en orden. Vacío = plantilla sin variables. */
  bodyParams: string[];
}

/** Contrato de envío de mensajes de WhatsApp (salida). */
export interface WhatsappProvider {
  /** Envía un mensaje de texto libre al número `to` (E.164). Requiere ventana 24h abierta. */
  send(to: string, text: string): Promise<void>;
  /** Envía una plantilla aprobada a `to` (E.164). Válido fuera de la ventana de 24h. */
  sendTemplate(to: string, template: WhatsappTemplateMessage): Promise<void>;
}
