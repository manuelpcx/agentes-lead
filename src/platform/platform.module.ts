import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/**
 * Mantenedor de la plataforma (nosotros): listado de clientes y alta de
 * demos. Importa `AuthModule` para reusar el registro de empresa, que es el
 * mismo camino que sigue un cliente real al darse de alta.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
