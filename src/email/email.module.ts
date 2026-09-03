import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Módulo global de correo. El proveedor (Resend/SMTP) se resuelve por empresa
 * con sus credenciales (BYO); sin config, no envía.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
