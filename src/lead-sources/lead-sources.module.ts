import { Module } from '@nestjs/common';
import { ImportModule } from '../import/import.module';
import { AuditModule } from '../audit/audit.module';
import { LeadSourcesService } from './lead-sources.service';
import { PanelLeadSourcesController } from './panel-lead-sources.controller';

/** Fuentes de leads por API: Integraciones + botón "Cargar nuevos leads". */
@Module({
  imports: [ImportModule, AuditModule],
  controllers: [PanelLeadSourcesController],
  providers: [LeadSourcesService],
})
export class LeadSourcesModule {}
