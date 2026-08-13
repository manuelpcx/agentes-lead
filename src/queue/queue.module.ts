import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_AGENT_TURN,
  QUEUE_LEAD_FOLLOWUP,
  QUEUE_LEAD_INGESTION,
} from './queue.constants';

/**
 * Configuración raíz de BullMQ (conexión Redis + opciones de reintento) y
 * registro de la cola de ingesta de leads. Otros módulos importan
 * `BullModule.registerQueue` para inyectar la cola donde la necesiten.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        connection: { url: config.get('REDIS_URL') },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_LEAD_INGESTION }),
    BullModule.registerQueue({ name: QUEUE_AGENT_TURN }),
    BullModule.registerQueue({ name: QUEUE_LEAD_FOLLOWUP }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
