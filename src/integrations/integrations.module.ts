import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { IntegrationTester } from './integration-tester.service';

/**
 * Credenciales de proveedores por empresa (BYO). Global para que las fachadas
 * (WhatsApp/correo/voz) resuelvan el proveedor de cada empresa en el envío.
 */
@Global()
@Module({
  providers: [CredentialsService, IntegrationTester],
  exports: [CredentialsService, IntegrationTester],
})
export class IntegrationsModule {}
