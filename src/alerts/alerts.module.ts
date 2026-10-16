import { Global, Module } from '@nestjs/common';
import { ProviderHealthService } from './provider-health.service';
import { IncidentNotifier } from './incident-notifier.service';
import { AlertsQueryService } from './alerts-query.service';
import { PanelAlertsController } from './panel-alerts.controller';

/**
 * Alertas de proveedores. Global porque lo usan los puntos de salida de
 * varios módulos (WhatsApp, correo, voz, IA). Depende de Prisma, Redis
 * (`REDIS_CLIENT`) y `PlatformEmailService`, que también son globales.
 */
@Global()
@Module({
  controllers: [PanelAlertsController],
  providers: [ProviderHealthService, IncidentNotifier, AlertsQueryService],
  exports: [ProviderHealthService, AlertsQueryService],
})
export class AlertsModule {}
