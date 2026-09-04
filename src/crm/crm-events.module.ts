import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_CRM_EVENTS } from '../queue/queue.constants';
import { CrmEventsService } from './crm-events.service';
import { CrmEventsProcessor } from './crm-events.processor';

/**
 * Eventos salientes hacia el CRM del cliente (BYO, canal 'crm'): cambios de
 * estado, promesas de pago, citas agendadas. `CredentialsService` es global,
 * no hace falta importar `IntegrationsModule` aquí.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_CRM_EVENTS })],
  providers: [CrmEventsService, CrmEventsProcessor],
  exports: [CrmEventsService],
})
export class CrmEventsModule {}
