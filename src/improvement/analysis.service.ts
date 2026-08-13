import { Injectable, Logger } from '@nestjs/common';
import { Channel, Direction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { KnowledgeGapsService } from './knowledge-gaps.service';
import { ExampleLibraryService } from './example-library.service';

const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

const ANALYSIS_SYSTEM = `Eres un analista de calidad de un agente de ventas. Recibes la transcripción de una conversación y detectas oportunidades de mejora.

Responde SOLO con JSON válido (sin texto adicional, sin markdown) con esta forma:
{
  "gaps": [{"question": "pregunta que el agente no supo responder o evadió", "suggestedAnswer": "respuesta sugerida si la puedes inferir, o null"}],
  "positiveExample": {"situation": "resumen de la situación", "agentResponse": "la respuesta del agente que funcionó bien", "outcome": "qué se logró (agendó/cerró/etc.)"}
}
Si no hay vacíos, "gaps" es []. Si no hubo un buen ejemplo claro (con desenlace positivo), "positiveExample" es null.`;

interface AnalysisResult {
  gaps?: Array<{ question?: string; suggestedAnswer?: string | null }>;
  positiveExample?: {
    situation?: string;
    agentResponse?: string;
    outcome?: string;
  } | null;
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly gaps: KnowledgeGapsService,
    private readonly examples: ExampleLibraryService,
  ) {}

  /**
   * Analiza una conversación con el LLM y registra vacíos y ejemplos. Marca
   * `analyzedAt` solo si se pudo analizar (sin LLM, se deja para más tarde).
   */
  async analyzeConversation(conversationId: string): Promise<void> {
    if (!this.anthropic.isConfigured()) {
      return; // sin LLM no analizamos; se reintenta cuando haya key
    }

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
    });
    if (!conversation) {
      return;
    }

    const interactions = await this.prisma.db.interaction.findMany({
      where: {
        leadId: conversation.leadId,
        channel: { in: CONVERSATION_CHANNELS },
        occurredAt: { gte: conversation.startedAt },
      },
      orderBy: { occurredAt: 'asc' },
      take: 100,
      select: { direction: true, content: true },
    });
    if (interactions.length === 0) {
      await this.markAnalyzed(conversationId);
      return;
    }

    const transcript = interactions
      .map(
        (i) =>
          `${i.direction === Direction.inbound ? 'Cliente' : 'Agente'}: ${i.content}`,
      )
      .join('\n');

    try {
      const raw = await this.anthropic.complete(ANALYSIS_SYSTEM, transcript);
      const result = this.parseJson(raw);
      if (result) {
        for (const gap of result.gaps ?? []) {
          if (gap.question) {
            await this.gaps.recordGap(
              gap.question,
              gap.suggestedAnswer ?? undefined,
              conversationId,
            );
          }
        }
        const ex = result.positiveExample;
        if (ex?.situation && ex.agentResponse) {
          await this.examples.record(
            ex.situation,
            ex.agentResponse,
            ex.outcome ?? 'positivo',
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Análisis fallido (conversationId=${conversationId}): ${(error as Error).message}`,
      );
    }

    await this.markAnalyzed(conversationId);
  }

  private async markAnalyzed(conversationId: string): Promise<void> {
    await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { analyzedAt: new Date() },
    });
  }

  /** Extrae el primer objeto JSON del texto (tolera fences de markdown). */
  private parseJson(text: string): AnalysisResult | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1)) as AnalysisResult;
    } catch {
      return null;
    }
  }
}
