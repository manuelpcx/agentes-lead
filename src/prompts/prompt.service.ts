import { Injectable } from '@nestjs/common';
import { AgentType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { getDefaultPrompt } from './default-prompts';

/** Cliente Prisma aceptable (permite uso dentro de transacciones). */
type PrismaLike = Pick<PrismaService['db'], 'promptVersion'>;

@Injectable()
export class PromptService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Siembra la versión 1 activa del system prompt de un agente recién creado.
   * Se llama dentro de la transacción de creación de la empresa/agente.
   */
  async seedDefaultPrompt(
    companyId: string,
    agentId: string,
    type: AgentType,
    client: PrismaLike,
  ): Promise<void> {
    await client.promptVersion.create({
      data: {
        companyId,
        agentId,
        version: 1,
        content: getDefaultPrompt(type),
        changeReason: 'Prompt por defecto al crear el agente',
        isActive: true,
        createdBy: 'system',
      },
    });
  }

  /**
   * Devuelve el contenido del prompt ACTIVO del agente. Si por algún motivo no
   * hay versión activa, cae al prompt por defecto de VENTAS (nunca deja al
   * agente sin instrucciones).
   */
  async getActiveContent(agentId: string, type: AgentType): Promise<string> {
    const active = await this.prisma.db.promptVersion.findFirst({
      where: { agentId, isActive: true },
      orderBy: { version: 'desc' },
      select: { content: true },
    });
    return active?.content ?? getDefaultPrompt(type);
  }
}
