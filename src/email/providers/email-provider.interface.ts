/** Token de inyección del proveedor de correo activo. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Un correo a enviar. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** A dónde van las respuestas (el buzón real de la empresa). */
  replyTo?: string;
  /**
   * Etiquetas para identificar el envío en los eventos del proveedor
   * (Resend las devuelve en sus webhooks). Solo letras, números, `_` y `-`.
   */
  tags?: Record<string, string>;
}

/** Contrato de envío de correo. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
