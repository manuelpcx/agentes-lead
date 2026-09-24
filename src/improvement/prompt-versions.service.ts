import { Injectable, NotFoundException } from '@nestjs/common';
import { PromptVersion } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { getDefaultPrompt } from '../prompts/default-prompts';

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

  /**
   * Crea una versión con el prompt por defecto ACTUAL del código (el que
   * devuelve `getDefaultPrompt` según el tipo del agente) y la activa de
   * inmediato. Útil cuando se corrige el prompt por defecto en el código
   * después de que un agente ya fue creado — el seed original solo corre una
   * vez, así que sin esto el agente se queda con el prompt viejo para siempre.
   */
  async resetToDefault(
    agentId: string,
    userId: string,
  ): Promise<PromptVersion> {
    const agent = await this.prisma.db.agent.findFirst({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundException('Agente no encontrado');
    }
    const proposal = await this.createProposal(
      agentId,
      getDefaultPrompt(agent.type),
      'Restablecido al prompt por defecto actual del código',
    );
    return this.activate(proposal.id, userId);
  }

  /**
   * Guarda una edición manual del prompt (hecha por el dueño desde el panel)
   * como nueva versión y la activa de inmediato — a diferencia de una
   * propuesta del playbook, el dueño ya decidió al escribirla, así que no
   * tiene sentido pedirle que "apruebe" su propia edición en un segundo paso.
   */
  async saveEdit(
    agentId: string,
    content: string,
    userId: string,
  ): Promise<PromptVersion> {
    const agent = await this.prisma.db.agent.findFirst({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundException('Agente no encontrado');
    }
    const proposal = await this.createProposal(
      agentId,
      content,
      'Editado manualmente desde el panel',
    );
    return this.activate(proposal.id, userId);
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
