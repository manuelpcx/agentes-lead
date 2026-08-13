import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { EmailService } from './email.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';
import { LogEmailProvider } from './providers/log.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';

/** Módulo global de correo (proveedor `log` o `smtp`). */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>): EmailProvider => {
        if (config.get('EMAIL_PROVIDER', { infer: true }) === 'smtp') {
          return new SmtpEmailProvider({
            host: config.get('SMTP_HOST', { infer: true }) as string,
            port: config.get('SMTP_PORT', { infer: true }) ?? 587,
            secure: config.get('SMTP_SECURE', { infer: true }),
            user: config.get('SMTP_USER', { infer: true }),
            pass: config.get('SMTP_PASS', { infer: true }),
            from: config.get('EMAIL_FROM', { infer: true }),
          });
        }
        return new LogEmailProvider();
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
