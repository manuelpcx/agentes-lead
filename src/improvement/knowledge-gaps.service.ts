import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KnowledgeGap,
  KnowledgeGapStatus,
  KnowledgeSourceType,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { KnowledgeDocumentService } from '../knowledge/knowledge-document.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class KnowledgeGapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: KnowledgeDocumentService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra un vacío detectado. Si ya existe uno PENDIENTE con la misma
   * pregunta (insensible a mayúsculas), incrementa su frecuencia en vez de
   * duplicar.
   */
  async recordGap(
    question: string,
    suggestedAnswer?: string,
    conversationId?: string,
  ): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const existing = await this.prisma.db.knowledgeGap.findFirst({
      where: {
        status: KnowledgeGapStatus.PENDIENTE,
        question: { equals: question, mode: 'insensitive' },
      },
    });
    if (existing) {
      await this.prisma.db.knowledgeGap.update({
        where: { id: existing.id },
        data: {
          frequency: { increment: 1 },
          suggestedAnswer: existing.suggestedAnswer ?? suggestedAnswer,
        },
      });
      return;
    }
    await this.prisma.db.knowledgeGap.create({
      data: { companyId, conversationId, question, suggestedAnswer },
    });
  }

  /** Lista los vacíos pendientes, ordenados por frecuencia. */
  async listPending(): Promise<KnowledgeGap[]> {
    return this.prisma.db.knowledgeGap.findMany({
      where: { status: KnowledgeGapStatus.PENDIENTE },
      orderBy: [{ frequency: 'desc' }, { detectedAt: 'asc' }],
      take: 100,
    });
  }

  /**
   * Aprueba un vacío: la respuesta entra a la base de conocimiento como FAQ
   * (indexada) y el vacío queda resuelto.
   */
  async approve(
    id: string,
    answer: string | undefined,
    userId: string,
  ): Promise<void> {
    const gap = await this.getById(id);
    const finalAnswer = answer?.trim() || gap.suggestedAnswer;
    if (!finalAnswer) {
      throw new BadRequestException('Se requiere una respuesta para aprobar');
    }

    await this.documents.create({
      title: `FAQ: ${gap.question.slice(0, 80)}`,
      sourceType: KnowledgeSourceType.faq,
      content: `P: ${gap.question}\nR: ${finalAnswer}`,
    });
    await this.prisma.db.knowledgeGap.update({
      where: { id },
      data: {
        status: KnowledgeGapStatus.APROBADO,
        suggestedAnswer: finalAnswer,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      userId,
      action: 'approve_knowledge_gap',
      entity: 'KnowledgeGap',
      entityId: id,
      newValue: { question: gap.question, answer: finalAnswer },
    });
  }

  /** Rechaza un vacío (no entra a la base). */
  async reject(id: string, userId: string): Promise<void> {
    await this.getById(id);
    await this.prisma.db.knowledgeGap.update({
      where: { id },
      data: {
        status: KnowledgeGapStatus.RECHAZADO,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      userId,
      action: 'reject_knowledge_gap',
      entity: 'KnowledgeGap',
      entityId: id,
    });
  }

  private async getById(id: string): Promise<KnowledgeGap> {
    const gap = await this.prisma.db.knowledgeGap.findFirst({ where: { id } });
    if (!gap) {
      throw new NotFoundException('Vacío de conocimiento no encontrado');
    }
    return gap;
  }
}
