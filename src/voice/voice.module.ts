import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { InteractionsModule } from '../interactions/interactions.module';
import { VoiceService } from './voice.service';
import { VoiceInboundService } from './voice-inbound.service';
import { VoiceCatalogService } from './voice-catalog.service';
import { VoiceController } from './voice.controller';
import {
  VOICE_PROVIDER,
  VoiceProvider,
} from './providers/voice-provider.interface';
import { LogVoiceProvider } from './providers/log.provider';
import { VapiVoiceProvider } from './providers/vapi.provider';
import { RetellVoiceProvider } from './providers/retell.provider';

/** Módulo global de llamadas de voz (proveedor `log`, `vapi` o `retell`). */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    InteractionsModule,
  ],
  controllers: [VoiceController],
  providers: [
    {
      provide: VOICE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>): VoiceProvider => {
        const provider = config.get('VOICE_PROVIDER', { infer: true });
        if (provider === 'retell') {
          return new RetellVoiceProvider({
            apiKey: config.get('RETELL_API_KEY', { infer: true }) as string,
            fromNumber: config.get('RETELL_FROM_NUMBER', {
              infer: true,
            }) as string,
            agentId: config.get('RETELL_AGENT_ID', { infer: true }),
          });
        }
        if (provider === 'vapi') {
          return new VapiVoiceProvider({
            apiKey: config.get('VAPI_API_KEY', { infer: true }) as string,
            phoneNumberId: config.get('VAPI_PHONE_NUMBER_ID', { infer: true }),
            assistantId: config.get('VAPI_ASSISTANT_ID', { infer: true }),
          });
        }
        return new LogVoiceProvider();
      },
    },
    VoiceService,
    VoiceInboundService,
    VoiceCatalogService,
  ],
  exports: [VoiceService, VoiceCatalogService],
})
export class VoiceModule {}
