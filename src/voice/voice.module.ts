import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { InteractionsModule } from '../interactions/interactions.module';
import { VoiceService } from './voice.service';
import { VoiceInboundService } from './voice-inbound.service';
import { VoiceCatalogService } from './voice-catalog.service';
import { VoiceController } from './voice.controller';

/**
 * Módulo global de llamadas de voz. El proveedor (Retell/Vapi) se resuelve por
 * empresa con sus credenciales (BYO); sin config, no llama.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    InteractionsModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceInboundService, VoiceCatalogService],
  exports: [VoiceService, VoiceCatalogService],
})
export class VoiceModule {}
