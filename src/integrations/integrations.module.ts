import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';

/**
 * Credenciales de proveedores por empresa (BYO). Global para que las fachadas
 * (WhatsApp/correo/voz) resuelvan el proveedor de cada empresa en el envío.
 */
@Global()
@Module({
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class IntegrationsModule {}
