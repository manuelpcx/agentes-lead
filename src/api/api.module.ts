import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PanelModule } from '../panel/panel.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AgentsModule } from '../agents/agents.module';
import { CompaniesModule } from '../companies/companies.module';
import { ImprovementModule } from '../improvement/improvement.module';
import { ApiController } from './api.controller';

/**
 * API pública para integraciones (`/api/v1`), autenticada por llave de API.
 * La consume el servidor MCP de `mcp/`. No tiene servicios propios: reusa los
 * del panel para que la lógica (y la auditoría) sea exactamente la misma.
 */
@Module({
  imports: [
    ApiKeysModule,
    PanelModule,
    AppointmentsModule,
    AgentsModule,
    CompaniesModule,
    ImprovementModule,
  ],
  controllers: [ApiController],
})
export class ApiModule {}
