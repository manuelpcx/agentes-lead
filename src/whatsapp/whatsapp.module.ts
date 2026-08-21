import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { CommonModule } from '../common/common.module';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappController } from './whatsapp.controller';
import {
  WHATSAPP_PROVIDER,
  WhatsappProvider,
} from './providers/whatsapp-provider.interface';
import { LogWhatsappProvider } from './providers/log.provider';
import { MetaCloudWhatsappProvider } from './providers/meta-cloud.provider';
import { YCloudWhatsappProvider } from './providers/ycloud.provider';

/**
 * Canal WhatsApp: envío (proveedor `log` o `meta`), entrada (webhook Meta +
 * simulación dev) y despertar del agente vía la cola `agent-turn`.
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
    {
      provide: WHATSAPP_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>): WhatsappProvider => {
        const provider = config.get('WHATSAPP_PROVIDER', { infer: true });
        if (provider === 'meta') {
          const token = config.get('WHATSAPP_TOKEN', { infer: true }) as string;
          const phoneId = config.get('WHATSAPP_PHONE_NUMBER_ID', {
            infer: true,
          }) as string;
          return new MetaCloudWhatsappProvider(token, phoneId);
        }
        if (provider === 'ycloud') {
          const apiKey = config.get('YCLOUD_API_KEY', {
            infer: true,
          }) as string;
          const from = config.get('YCLOUD_FROM', { infer: true }) as string;
          return new YCloudWhatsappProvider(apiKey, from);
        }
        return new LogWhatsappProvider();
      },
    },
    WhatsappService,
    WhatsappInboundService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
