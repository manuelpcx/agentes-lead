import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Módulo global de cifrado; `CryptoService` disponible en toda la app. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
