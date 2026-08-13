import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { LeadIngestionProcessor } from './lead-ingestion.processor';
import { QUEUE_LEAD_INGESTION } from '../queue/queue.constants';
import { LeadsModule } from '../leads/leads.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_LEAD_INGESTION }),
    LeadsModule,
    CommonModule,
  ],
  controllers: [WebhooksController],
  providers: [LeadIngestionProcessor],
})
export class WebhooksModule {}
