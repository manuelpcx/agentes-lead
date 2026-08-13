import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AuditModule } from '../audit/audit.module';
import { KnowledgeGapsService } from './knowledge-gaps.service';
import { ExampleLibraryService } from './example-library.service';
import { PromptVersionsService } from './prompt-versions.service';
import { MetricsService } from './metrics.service';
import { AnalysisService } from './analysis.service';
import { PlaybookService } from './playbook.service';
import { ImprovementScheduler } from './improvement.scheduler';
import { PanelImprovementController } from './panel-improvement.controller';

/**
 * Mejora continua (Fase 6): análisis de conversaciones, vacíos de conocimiento,
 * biblioteca de ejemplos, propuestas de prompt, métricas y cola de aprobación.
 * `LlmModule`, `EmbeddingsModule` y `AuthModule` son globales.
 */
@Module({
  imports: [KnowledgeModule, AuditModule],
  controllers: [PanelImprovementController],
  providers: [
    KnowledgeGapsService,
    ExampleLibraryService,
    PromptVersionsService,
    MetricsService,
    AnalysisService,
    PlaybookService,
    ImprovementScheduler,
  ],
  exports: [ExampleLibraryService],
})
export class ImprovementModule {}
