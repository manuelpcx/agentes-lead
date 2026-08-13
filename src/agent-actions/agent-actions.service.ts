import { Injectable } from '@nestjs/common';
import { AgentAction, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

/** Datos de una acción del agente a registrar. */
export interface RecordActionInput {
  agentId: string;
  leadId: string;
  conversationId?: string | null;
  tool: string;
  input: Prisma.InputJsonValue;
  output: string;
  isError?: boolean;
}

/**
 * Registra y consulta las acciones del agente (uso de herramientas). Alimenta
 * el "registro de acciones" del panel: qué herramienta usó, con qué parámetros
 * y qué devolvió.
 */
@Injectable()
export class AgentActionsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: RecordActionInput): Promise<void> {
    await this.prisma.db.agentAction.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        agentId: data.agentId,
        leadId: data.leadId,
        conversationId: data.conversationId ?? null,
        tool: data.tool,
        input: data.input,
        output: data.output.slice(0, 4000),
        isError: data.isError ?? false,
      },
    });
  }

  /** Lista las acciones del agente sobre un lead (aislado por tenant). */
  async listForLead(leadId: string): Promise<AgentAction[]> {
    return this.prisma.db.agentAction.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    });
  }
}
