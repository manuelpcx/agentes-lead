import { BadRequestException, Injectable } from '@nestjs/common';
import { Channel, Direction, Lead, LeadStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly agentActions: AgentActionsService,
    private readonly whatsapp: WhatsappService,
    private readonly audit: AuditService,
  ) {}

  /** Bandeja: leads con su último mensaje (aislado por tenant). */
  async listLeads(status?: LeadStatus) {
    const leads = await this.prisma.db.lead.findMany({
      where: status ? { status } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        interactions: {
          orderBy: { occurredAt: 'desc' },
          take: 1,
          select: {
            content: true,
            channel: true,
            direction: true,
            occurredAt: true,
          },
        },
      },
    });

    return leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      isPausedForHuman: lead.isPausedForHuman,
      updatedAt: lead.updatedAt,
      lastMessage: lead.interactions[0] ?? null,
    }));
  }

  /** Detalle: lead + hilo completo + registro de acciones del agente. */
  async getLeadDetail(leadId: string) {
    const lead = await this.leads.getById(leadId);
    const interactions = await this.prisma.db.interaction.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'asc' },
      take: 300,
    });
    const agentActions = await this.agentActions.listForLead(leadId);
    return { lead, interactions, agentActions };
  }

  /** Toma el control humano: pausa al agente para este lead. */
  async takeControl(leadId: string, userId: string): Promise<Lead> {
    const lead = await this.leads.getById(leadId);
    const updated = await this.prisma.db.lead.update({
      where: { id: leadId },
      data: { isPausedForHuman: true },
    });
    await this.audit.record({
      userId,
      action: 'take_control',
      entity: 'Lead',
      entityId: leadId,
      previousValue: { isPausedForHuman: lead.isPausedForHuman },
      newValue: { isPausedForHuman: true },
    });
    return updated;
  }

  /** Devuelve el control al agente. */
  async releaseControl(leadId: string, userId: string): Promise<Lead> {
    const lead = await this.leads.getById(leadId);
    const updated = await this.prisma.db.lead.update({
      where: { id: leadId },
      data: { isPausedForHuman: false },
    });
    await this.audit.record({
      userId,
      action: 'release_control',
      entity: 'Lead',
      entityId: leadId,
      previousValue: { isPausedForHuman: lead.isPausedForHuman },
      newValue: { isPausedForHuman: false },
    });
    return updated;
  }

  /**
   * Respuesta manual del operador: envía por WhatsApp y registra la interacción
   * (sin agente). Pausa al agente para evitar respuestas cruzadas.
   */
  async humanReply(leadId: string, text: string, userId: string) {
    const lead = await this.leads.getById(leadId);
    if (!lead.phone) {
      throw new BadRequestException('El lead no tiene teléfono');
    }
    if (!lead.isPausedForHuman) {
      await this.prisma.db.lead.update({
        where: { id: leadId },
        data: { isPausedForHuman: true },
      });
    }

    await this.whatsapp.send(lead.phone, text);
    await this.interactions.register({
      leadId,
      channel: Channel.whatsapp,
      direction: Direction.outbound,
      content: text,
      agentId: null,
      metadata: { byUserId: userId },
    });
    await this.audit.record({
      userId,
      action: 'human_reply',
      entity: 'Lead',
      entityId: leadId,
      newValue: { text },
    });
    return { sent: true };
  }
}
