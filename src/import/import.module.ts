import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AgentsModule } from '../agents/agents.module';
import { AuditModule } from '../audit/audit.module';
import { LeadImportService } from './lead-import.service';
import { PanelImportController } from './panel-import.controller';

/**
 * Importación masiva de leads desde el CRM anterior del cliente (CSV).
 * Aparte de `LeadsModule` a propósito: esa ingesta asume un lead recién
 * capturado y programa el primer contacto; esta trae una base histórica y por
 * defecto no contacta a nadie.
 */
@Module({
  imports: [CommonModule, AgentsModule, AuditModule],
  controllers: [PanelImportController],
  providers: [LeadImportService],
  exports: [LeadImportService],
})
export class ImportModule {}
