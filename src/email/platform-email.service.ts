import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import {
  EmailMessage,
  EmailProvider,
} from './providers/email-provider.interface';
import { LogEmailProvider } from './providers/log.provider';
import { ResendEmailProvider } from './providers/resend.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';

/**
 * Correo de la PLATAFORMA (no de una empresa): recuperación de contraseña y
 * similares. `EmailService` resuelve el proveedor con las credenciales BYO de
 * la empresa activa, pero un usuario del panel puede pertenecer a varias o a
 * ninguna con correo configurado — estos correos salen con el proveedor
 * global de las variables de entorno (`EMAIL_PROVIDER`, `EMAIL_FROM`, …).
 *
 * Con `EMAIL_PROVIDER=log` (desarrollo) el correo se imprime en el log, con
 * el enlace incluido: sirve para probar el flujo sin cuenta de correo.
 */
@Injectable()
export class PlatformEmailService {
  private readonly logger = new Logger(PlatformEmailService.name);
  private readonly provider: EmailProvider;

  constructor(config: ConfigService<EnvVars, true>) {
    this.provider = PlatformEmailService.build(config);
  }

  /** Elige el proveedor global. Sin credenciales, cae a `log` y avisa. */
  static build(config: ConfigService<EnvVars, true>): EmailProvider {
    const provider = config.get('EMAIL_PROVIDER', { infer: true });
    const from = config.get('EMAIL_FROM', { infer: true });

    if (provider === 'resend') {
      const apiKey = config.get('RESEND_API_KEY', { infer: true });
      if (apiKey) {
        return new ResendEmailProvider(apiKey, from);
      }
    }
    if (provider === 'smtp') {
      const host = config.get('SMTP_HOST', { infer: true });
      if (host) {
        return new SmtpEmailProvider({
          host,
          port: config.get('SMTP_PORT', { infer: true }) ?? 587,
          secure: config.get('SMTP_SECURE', { infer: true }),
          user: config.get('SMTP_USER', { infer: true }),
          pass: config.get('SMTP_PASS', { infer: true }),
          from,
        });
      }
    }
    if (provider !== 'log') {
      new Logger(PlatformEmailService.name).warn(
        `EMAIL_PROVIDER=${provider} sin credenciales completas: los correos de la plataforma se imprimen en el log en vez de enviarse.`,
      );
    }
    return new LogEmailProvider();
  }

  async send(message: EmailMessage): Promise<void> {
    await this.provider.send(message);
    this.logger.log(
      `Correo de plataforma enviado a ${message.to}: ${message.subject}`,
    );
  }
}
