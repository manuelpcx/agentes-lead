import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { PlatformEmailService } from './platform-email.service';

/**
 * Módulo global de correo. `EmailService` resuelve el proveedor por empresa
 * con sus credenciales (BYO); `PlatformEmailService` usa el proveedor global
 * de las variables de entorno para los correos de la plataforma (recuperar
 * contraseña). Sin config, ninguno envía: registran en el log.
 */
@Global()
@Module({
  providers: [EmailService, PlatformEmailService],
  exports: [EmailService, PlatformEmailService],
})
export class EmailModule {}
