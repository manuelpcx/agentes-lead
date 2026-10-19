import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_LEAD_MEMORY } from '../queue/queue.constants';
import { LeadMemoryService } from './lead-memory.service';
import { LeadMemoryProcessor } from './lead-memory.processor';
import { ConversationRecallService } from './conversation-recall.service';

/**
 * Memoria viva del lead. Es global porque la consultan el constructor de
 * contexto, una herramienta del agente y el panel, y no aporta nada obligar a
 * cada uno a importar el módulo. `LlmModule` ya es global.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_LEAD_MEMORY })],
  providers: [
    LeadMemoryService,
    LeadMemoryProcessor,
    ConversationRecallService,
  ],
  exports: [LeadMemoryService, ConversationRecallService],
})
export class MemoryModule {}
