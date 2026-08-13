import { Global, Module } from '@nestjs/common';
import { PromptService } from './prompt.service';

/** Módulo global de prompts (versión activa del system prompt por agente). */
@Global()
@Module({
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
