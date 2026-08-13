import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeGapStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { PromptVersionsService } from './prompt-versions.service';

const PLAYBOOK_SYSTEM = `Eres un experto en prompts de agentes de ventas por chat. Recibes el system prompt actual de un agente y señales de sus conversaciones (vacíos y objeciones recurrentes). Propón una versión mejorada del system prompt que conserve las reglas de seguridad (nunca inventar precios/datos, consultar siempre por herramienta) y aborde mejor esas objeciones. Devuelve SOLO el nuevo system prompt completo, sin explicaciones ni markdown.`;

/**
 * Análisis de playbook (Fase 6): propone ajustes al system prompt como una
 * nueva PromptVersion INACTIVA. Nada entra a producción sin aprobación humana.
 */
@Injectable()
export class PlaybookService {
  private readonly logger = new Logger(PlaybookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly promptVersions: PromptVersionsService,
  ) {}

  async proposeForAgent(agentId: string): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return;
    }

    const active = await this.prisma.db.promptVersion.findFirst({
      where: { agentId, isActive: true },
      orderBy: { version: 'desc' },
      select: { content: true },
    });
    const base = active?.content ?? '';

    const gaps = await this.prisma.db.knowledgeGap.findMany({
      where: { status: KnowledgeGapStatus.PENDIENTE },
      orderBy: { frequency: 'desc' },
      take: 10,
      select: { question: true, frequency: true },
    });
    const signal =
      gaps.map((g) => `- (${g.frequency}x) ${g.question}`).join('\n') ||
      '(sin vacíos recurrentes)';

    const user = `PROMPT ACTUAL:\n${base}\n\nSEÑALES (vacíos/objeciones recurrentes):\n${signal}`;

    try {
      const proposal = await this.anthropic.complete(PLAYBOOK_SYSTEM, user);
      if (proposal.length > 50 && proposal !== base) {
        await this.promptVersions.createProposal(
          agentId,
          proposal,
          'Propuesta automática del análisis de playbook',
        );
        this.logger.log(`Propuesta de prompt creada (agentId=${agentId})`);
      }
    } catch (error) {
      this.logger.warn(
        `Propuesta de playbook fallida (agentId=${agentId}): ${(error as Error).message}`,
      );
    }
  }
}
