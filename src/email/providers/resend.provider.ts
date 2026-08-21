import { Logger } from '@nestjs/common';
import { EmailMessage, EmailProvider } from './email-provider.interface';

/**
 * Proveedor de correo vía la API HTTP de Resend (https://resend.com). Se usa en
 * la nube porque los PaaS suelen bloquear SMTP; la API va por HTTPS (puerto 443)
 * y no la bloquean. `from` debe ser de un dominio verificado en Resend.
 * Doc: https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email(resend)');
  private readonly url = 'https://api.resend.com/emails';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Resend respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new Error(`Fallo al enviar correo (Resend ${response.status})`);
    }
  }
}
