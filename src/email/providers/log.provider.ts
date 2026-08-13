import { Logger } from '@nestjs/common';
import { EmailMessage, EmailProvider } from './email-provider.interface';

/** Proveedor de correo para desarrollo: registra el correo, no lo envía. */
export class LogEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email(log)');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`→ ${message.to} | ${message.subject}\n${message.text}`);
  }
}
