/** Token de inyección del proveedor de correo activo. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Un correo a enviar. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Contrato de envío de correo. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
