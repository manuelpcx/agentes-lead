import { Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceIssue, ComplianceIssueStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';

/**
 * Cola de aprobación de fallas de cumplimiento (distinta de los vacíos de
 * conocimiento): el agente no respetó una de SUS PROPIAS reglas activas — se
 * detecta comparando la transcripción contra el prompt real de ESE agente, así
 * que la evaluación es intrínsecamente distinta por agente/tipo. Nada cambia
 * el comportamiento del agente solo por detectarse: es solo visibilidad para
 * el dueño, que decide si ajusta el prompt o el código.
 */
@Injectable()
export class ComplianceIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra una falla detectada. Si ya existe una PENDIENTE con la misma
   * descripción para el mismo agente, incrementa su frecuencia en vez de
   * duplicar (mismo patrón que KnowledgeGapsService.recordGap).
   */
  async recordIssue(
    agentId: string,
    issue: string,
    evidence: string | undefined,
    conversationId: string | undefined,
  ): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const existing = await this.prisma.db.complianceIssue.findFirst({
      where: {
        agentId,
        status: ComplianceIssueStatus.PENDIENTE,
        issue: { equals: issue, mode: 'insensitive' },
      },
    });
    if (existing) {
      await this.prisma.db.complianceIssue.update({
        where: { id: existing.id },
        data: {
          frequency: { increment: 1 },
          evidence: existing.evidence ?? evidence,
        },
      });
      return;
    }
    await this.prisma.db.complianceIssue.create({
      data: { companyId, agentId, conversationId, issue, evidence },
    });
  }

  /** Lista las fallas pendientes, opcionalmente filtradas por agente. */
  async listPending(
    agentId?: string,
  ): Promise<(ComplianceIssue & { agentName: string })[]> {
    const issues = await this.prisma.db.complianceIssue.findMany({
      where: {
        status: ComplianceIssueStatus.PENDIENTE,
        ...(agentId ? { agentId } : {}),
      },
      orderBy: [{ frequency: 'desc' }, { detectedAt: 'asc' }],
      take: 100,
      include: { agent: { select: { name: true } } },
    });
    return issues.map(({ agent, ...issue }) => ({
      ...issue,
      agentName: agent.name,
    }));
  }

  /** Reconoce una falla como real (queda como antecedente para el playbook). */
  async approve(id: string, userId: string): Promise<void> {
    await this.getById(id);
    await this.prisma.db.complianceIssue.update({
      where: { id },
      data: {
        status: ComplianceIssueStatus.APROBADO,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      userId,
      action: 'approve_compliance_issue',
      entity: 'ComplianceIssue',
      entityId: id,
    });
  }

  /** Descarta una falla (falso positivo o no aplica). */
  async reject(id: string, userId: string): Promise<void> {
    await this.getById(id);
    await this.prisma.db.complianceIssue.update({
      where: { id },
      data: {
        status: ComplianceIssueStatus.RECHAZADO,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      userId,
      action: 'reject_compliance_issue',
      entity: 'ComplianceIssue',
      entityId: id,
    });
  }

  private async getById(id: string): Promise<ComplianceIssue> {
    const issue = await this.prisma.db.complianceIssue.findFirst({
      where: { id },
    });
    if (!issue) {
      throw new NotFoundException('Falla de cumplimiento no encontrada');
    }
    return issue;
  }
}
