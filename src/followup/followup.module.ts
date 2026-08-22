import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_LEAD_FOLLOWUP } from '../queue/queue.constants';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { AgentModule } from '../agent/agent.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FollowUpService } from './followup.service';
import { FollowUpScheduler } from './followup.scheduler';
import { FollowUpProcessor } from './followup.processor';

/** Seguimiento automático (Fase 4): cron + cola + servicio. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_LEAD_FOLLOWUP }),
    LeadsModule,
    InteractionsModule,
    AgentModule,
    WhatsappModule,
  ],
  providers: [FollowUpService, FollowUpScheduler, FollowUpProcessor],
})
export class FollowupModule {}
