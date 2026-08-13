import { Global, Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';

/** Módulo global del LLM; `AnthropicService` disponible en toda la app. */
@Global()
@Module({
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class LlmModule {}
