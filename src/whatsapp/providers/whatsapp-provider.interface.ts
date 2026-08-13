/** Token de inyección del proveedor de WhatsApp activo. */
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/** Contrato de envío de mensajes de WhatsApp (salida). */
export interface WhatsappProvider {
  /** Envía un mensaje de texto al número `to` (E.164). */
  send(to: string, text: string): Promise<void>;
}
