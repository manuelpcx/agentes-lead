import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { KnowledgeController } from './knowledge.controller';
import { FactsController } from './facts.controller';
import { OnboardingController } from './onboarding.controller';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { SemanticSearchService } from './semantic-search.service';
import { StructuredFactsService } from './structured-facts.service';
import { OnboardingService } from './onboarding.service';

/**
 * Base de conocimiento (Fase 2): documentos + fragmentos vectoriales (RAG),
 * hechos estructurados (fuente de verdad) y onboarding de empresa.
 * `EmbeddingsModule` es global; `CommonModule` aporta el guard.
 */
@Module({
  imports: [CommonModule],
  controllers: [KnowledgeController, FactsController, OnboardingController],
  providers: [
    KnowledgeDocumentService,
    SemanticSearchService,
    StructuredFactsService,
    OnboardingService,
  ],
  exports: [
    KnowledgeDocumentService,
    SemanticSearchService,
    StructuredFactsService,
    OnboardingService,
  ],
})
export class KnowledgeModule {}
