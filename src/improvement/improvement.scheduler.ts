import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AnthropicService } from '../llm/anthropic.service';
import { AnalysisService } from './analysis.service';
import { MetricsService } from './metrics.service';
import { PlaybookService } from './playbook.service';

/**
 * Crons de mejora continua: análisis nocturno de conversaciones, cálculo
 * nocturno de métricas y análisis semanal de playbook. Lo dependiente del LLM
 * se salta si no hay `ANTHROPIC_API_KEY`.
 */
@Injectable()
export class ImprovementScheduler {
  private readonly logger = new Logger(ImprovementScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly analysis: AnalysisService,
    private readonly metrics: MetricsService,
    private readonly playbook: PlaybookService,
  ) {}

  /** Análisis nocturno (03:00): conversaciones no analizadas. */
  @Cron('0 0 3 * * *')
  async nightlyAnalysis(): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const pending = await this.prisma.raw.conversation.findMany({
      where: { analyzedAt: null },
      select: { id: true, companyId: true },
      take: 50,
    });
    for (const convo of pending) {
      await TenantContext.run(
        { companyId: convo.companyId, correlationId: randomUUID() },
        () => this.analysis.analyzeConversation(convo.id),
      );
    }
    if (pending.length > 0) {
      this.logger.log(`Conversaciones analizadas: ${pending.length}`);
    }
  }

  /** Métricas nocturnas (03:30): calcula el día anterior por empresa. */
  @Cron('0 30 3 * * *')
  async nightlyMetrics(): Promise<void> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const companies = await this.prisma.raw.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      await this.metrics.computeDaily(company.id, yesterday);
    }
  }

  /** Playbook semanal (lunes 04:00): propone ajustes de prompt por agente. */
  @Cron('0 0 4 * * 1')
  async weeklyPlaybook(): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const agents = await this.prisma.raw.agent.findMany({
      where: { isActive: true },
      select: { id: true, companyId: true },
    });
    for (const agent of agents) {
      await TenantContext.run(
        { companyId: agent.companyId, correlationId: randomUUID() },
        () => this.playbook.proposeForAgent(agent.id),
      );
    }
  }
}
