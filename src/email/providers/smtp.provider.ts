import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailProvider } from './email-provider.interface';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Proveedor de correo por SMTP (nodemailer). */
export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email(smtp)');
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      this.logger.error(`Fallo al enviar correo: ${(error as Error).message}`);
      throw error;
    }
  }
}
