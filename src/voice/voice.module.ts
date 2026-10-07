import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { InteractionsModule } from '../interactions/interactions.module';
import { VoiceService } from './voice.service';
import { VoiceInboundService } from './voice-inbound.service';
import { VoiceCatalogService } from './voice-catalog.service';
import { VoiceUsageService } from './voice-usage.service';
import { VoiceController } from './voice.controller';

/**
 * Módulo global de llamadas de voz. Cada empresa llama por su cuenta propia
 * (Retell, Vapi o ElevenLabs) o por la voz gestionada de la plataforma
 * (ElevenLabs), con tope mensual de minutos. Sin ninguna, no llama.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    InteractionsModule,
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    VoiceInboundService,
    VoiceCatalogService,
    VoiceUsageService,
  ],
  exports: [VoiceService, VoiceCatalogService, VoiceUsageService],
})
export class VoiceModule {}
