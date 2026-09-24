import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key.guard';
import { PanelApiKeysController } from './panel-api-keys.controller';

/**
 * Llaves de API por empresa: alta/revocación desde el panel y el guard que
 * las valida. Lo consume `ApiModule` (la superficie que usa el servidor MCP).
 */
@Module({
  imports: [CommonModule, AuditModule],
  controllers: [PanelApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}
