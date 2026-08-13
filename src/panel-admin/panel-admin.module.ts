import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AuditModule } from '../audit/audit.module';
import { PanelAdminController } from './panel-admin.controller';

/** Administración del panel (Fase 7B): conocimiento, empresa, agentes, onboarding. */
@Module({
  imports: [AgentsModule, KnowledgeModule, AuditModule],
  controllers: [PanelAdminController],
})
export class PanelAdminModule {}
