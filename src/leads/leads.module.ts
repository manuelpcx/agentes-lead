import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AgentsModule } from '../agents/agents.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [AgentsModule, InteractionsModule, CommonModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
