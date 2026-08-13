import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentRouterService } from './agent-router.service';

/**
 * Agentes y su enrutamiento. `AgentRouterService` decide quién queda a cargo de
 * un lead (Fase 8). `LlmModule` es global, por eso no se importa aquí.
 */
@Module({
  providers: [AgentsService, AgentRouterService],
  exports: [AgentsService, AgentRouterService],
})
export class AgentsModule {}
