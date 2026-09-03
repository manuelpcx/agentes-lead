import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { CommonModule } from '../common/common.module';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappController } from './whatsapp.controller';

/**
 * Canal WhatsApp: envío (proveedor resuelto por empresa con sus credenciales),
 * entrada (webhook Meta/YCloud + simulación dev) y despertar del agente vía la
 * cola `agent-turn`.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    CommonModule,
    LeadsModule,
    InteractionsModule,
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappInboundService,
    WhatsappTemplatesService,
  ],
  exports: [WhatsappService, WhatsappTemplatesService],
})
export class WhatsappModule {}
