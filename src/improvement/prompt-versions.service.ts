import { Injectable, NotFoundException } from '@nestjs/common';
import { PromptVersion } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PromptVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista las versiones de prompt de un agente (activa + propuestas). */
  async listForAgent(agentId: string): Promise<PromptVersion[]> {
    return this.prisma.db.promptVersion.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
  }

  /** Crea una versión propuesta (inactiva) del prompt de un agente. */
  async createProposal(
    agentId: string,
    content: string,
    changeReason: string,
  ): Promise<PromptVersion> {
    const companyId = TenantContext.requireCompanyId();
    const last = await this.prisma.db.promptVersion.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return this.prisma.db.promptVersion.create({
      data: {
        companyId,
        agentId,
        version: (last?.version ?? 0) + 1,
        content,
        changeReason,
        isActive: false,
        createdBy: 'analisis',
      },
    });
  }

  /** Activa una versión (desactiva las demás del agente). Reversible. */
  async activate(id: string, userId: string): Promise<PromptVersion> {
    const target = await this.prisma.db.promptVersion.findFirst({
      where: { id },
    });
    if (!target) {
      throw new NotFoundException('Versión de prompt no encontrada');
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.promptVersion.updateMany({
        where: { agentId: target.agentId, isActive: true },
        data: { isActive: false },
      });
      await tx.promptVersion.update({
        where: { id },
        data: { isActive: true },
      });
    });
    await this.audit.record({
      userId,
      action: 'activate_prompt_version',
      entity: 'PromptVersion',
      entityId: id,
      newValue: { version: target.version },
    });
    return target;
  }
}
