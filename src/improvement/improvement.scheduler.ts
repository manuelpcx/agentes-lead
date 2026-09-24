import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AnthropicService } from '../llm/anthropic.service';
import { AnalysisService } from './analysis.service';
import { MetricsService } from './metrics.service';
import { PlaybookService } from './playbook.service';

/** Horas de silencio tras las que una conversación se da por terminada. */
const IDLE_HOURS = 24;

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

  /**
   * Análisis nocturno (03:00): conversaciones TERMINADAS y no analizadas.
   *
   * Antes analizaba cualquier conversación abierta y la marcaba como
   * analizada, así que una charla evaluada en su tercer mensaje no se volvía a
   * mirar nunca. Ahora se cierran primero las que llevan un día en silencio y
   * solo se analizan esas: la unidad de análisis es una conversación completa.
   */
  @Cron('0 0 3 * * *')
  async nightlyAnalysis(): Promise<void> {
    await this.closeIdleConversations();
    if (!this.anthropic.isConfigured()) {
      return;
    }
    const pending = await this.prisma.raw.conversation.findMany({
      where: { analyzedAt: null, endedAt: { not: null } },
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

  /**
   * Cierra las conversaciones sin actividad en las últimas `IDLE_HOURS` horas.
   * `Conversation.endedAt` no lo escribía nadie, así que ninguna terminaba
   * nunca. El corte por inactividad garantiza que toda conversación se cierre
   * —y por lo tanto se analice— aunque el lead nunca llegue a un estado final.
   */
  private async closeIdleConversations(): Promise<void> {
    const corte = new Date(Date.now() - IDLE_HOURS * 60 * 60 * 1000);
    const abiertas = await this.prisma.raw.conversation.findMany({
      where: { endedAt: null, startedAt: { lt: corte } },
      select: { id: true, leadId: true },
      take: 500,
    });
    let cerradas = 0;
    for (const convo of abiertas) {
      const ultima = await this.prisma.raw.interaction.findFirst({
        where: { leadId: convo.leadId },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      });
      if (ultima && ultima.occurredAt > corte) {
        continue; // sigue viva
      }
      await this.prisma.raw.conversation.update({
        where: { id: convo.id },
        data: { endedAt: ultima?.occurredAt ?? new Date() },
      });
      cerradas++;
    }
    if (cerradas > 0) {
      this.logger.log(`Conversaciones cerradas por inactividad: ${cerradas}`);
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
