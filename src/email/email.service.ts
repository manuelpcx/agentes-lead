import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '../integrations/credentials.service';
import {
  EmailMessage,
  EmailProvider,
} from './providers/email-provider.interface';
import { LogEmailProvider } from './providers/log.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';
import { ResendEmailProvider } from './providers/resend.provider';

/**
 * Fachada de envío de correo. Resuelve el proveedor con las credenciales de la
 * empresa activa (BYO): Resend o SMTP con las llaves que el cliente configuró.
 * Si la empresa no tiene correo configurado, no envía (log).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(private readonly credentials: CredentialsService) {}

  private async provider(): Promise<EmailProvider> {
    const c = await this.credentials.get('email');
    if (c?.isActive) {
      if (c.provider === 'resend' && c.secret && c.config.from) {
        return new ResendEmailProvider(c.secret, String(c.config.from));
      }
      if (c.provider === 'smtp' && c.config.host && c.config.from) {
        return new SmtpEmailProvider({
          host: String(c.config.host),
          port: Number(c.config.port ?? 587),
          secure: c.config.secure === true || c.config.secure === 'true',
          user: c.config.user ? String(c.config.user) : undefined,
          pass: c.secret,
          from: String(c.config.from),
        });
      }
    }
    this.logger.warn(
      'Correo no configurado para la empresa: no se envía (configúralo en el panel).',
    );
    return new LogEmailProvider();
  }

  async send(message: EmailMessage): Promise<void> {
    return (await this.provider()).send(message);
  }
}
