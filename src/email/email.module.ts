import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { PlatformEmailService } from './platform-email.service';
import { ManagedEmailService } from './managed-email.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailDomainScheduler } from './email-domain.scheduler';
import { PanelEmailController } from './panel-email.controller';

/**
 * Módulo global de correo. `EmailService` envía el correo de una empresa: por
 * su cuenta propia (BYO) o por la cuenta de Resend de la plataforma (correo
 * gestionado, `ManagedEmailService`). `PlatformEmailService` usa el proveedor
 * global de las variables de entorno para los correos de la plataforma
 * (recuperar contraseña). Sin config, ninguno envía: registran en el log.
 */
@Global()
@Module({
  controllers: [PanelEmailController],
  providers: [
    EmailService,
    PlatformEmailService,
    ManagedEmailService,
    EmailQuotaService,
    EmailDomainScheduler,
  ],
  exports: [EmailService, PlatformEmailService, ManagedEmailService],
})
export class EmailModule {}
