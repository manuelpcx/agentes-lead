import { Module } from '@nestjs/common';
import { CompanyAuthGuard } from './tenant/company-auth.guard';

/**
 * Agrupa utilidades transversales inyectables. `PrismaModule` y `CryptoModule`
 * ya son globales; aquí se expone el guard para poder reusarlo por DI en los
 * controladores que lo apliquen.
 */
@Module({
  providers: [CompanyAuthGuard],
  exports: [CompanyAuthGuard],
})
export class CommonModule {}
