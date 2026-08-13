import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { AgentActionsModule } from '../agent-actions/agent-actions.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuditModule } from '../audit/audit.module';
import { PanelService } from './panel.service';
import { PanelController } from './panel.controller';

/** API del panel mínimo (Fase 7A). */
@Module({
  imports: [
    LeadsModule,
    InteractionsModule,
    AgentActionsModule,
    WhatsappModule,
    AuditModule,
  ],
  controllers: [PanelController],
  providers: [PanelService],
})
export class PanelModule {}
