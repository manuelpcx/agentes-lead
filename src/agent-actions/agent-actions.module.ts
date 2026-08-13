import { Module } from '@nestjs/common';
import { AgentActionsService } from './agent-actions.service';

@Module({
  providers: [AgentActionsService],
  exports: [AgentActionsService],
})
export class AgentActionsModule {}
