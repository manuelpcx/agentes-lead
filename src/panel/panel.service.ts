import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Direction, Lead, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadsService } from '../leads/leads.service';
import { InteractionsService } from '../interactions/interactions.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { CreateLeadDto, UpdateLeadDto } from './dto/lead.dto';
import { UpdateLeadMemoryDto } from './dto/lead-memory.dto';
import { IncomingLeadDto } from '../webhooks/dto/incoming-lead.dto';

@Injectable()
export class PanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly interactions: InteractionsService,
    private readonly agentActions: AgentActionsService,
    private readonly appointments: AppointmentsService,
    private readonly whatsapp: WhatsappService,
    private readonly audit: AuditService,
    private readonly memory: LeadMemoryService,
  ) {}

  /**
   * Bandeja: leads con su último mensaje (aislado por tenant). `q` busca en
   * nombre, teléfono, email e identificador de origen — es el buscador del CRM.
   */
  async listLeads(params: { status?: LeadStatus; q?: string } = {}) {
    const term = params.q?.trim();
    const where: Prisma.LeadWhereInput = {};
    if (params.status) {
      where.status = params.status;
    }
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
        { externalId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const leads = await this.prisma.db.lead.findMany({
      where,
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
      email: lead.email,
      status: lead.status,
      qualification: lead.qualification,
      isPausedForHuman: lead.isPausedForHuman,
      nextActionAt: lead.nextActionAt,
      updatedAt: lead.updatedAt,
      lastMessage: lead.interactions[0] ?? null,
    }));
  }

  /**
   * Detalle: lead + hilo completo + acciones del agente + lo que aporta el CRM
   * propio (citas y notas internas del equipo).
   */
  async getLeadDetail(leadId: string) {
    const lead = await this.leads.getById(leadId);
    const interactions = await this.prisma.db.interaction.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'asc' },
      take: 300,
    });
    const agentActions = await this.agentActions.listForLead(leadId);
    const appointments = await this.appointments.listForLead(leadId);
    const notes = await this.listNotes(leadId);
    const memory = await this.memory.get(leadId);
    return { lead, interactions, agentActions, appointments, notes, memory };
  }

  /**
   * Alta manual desde el panel. Reutiliza `LeadsService.ingest` para no
   * duplicar el enrutamiento al agente ni la programación del primer contacto:
   * un lead creado a mano se comporta igual que uno que entró por el webhook.
   */
  async createLead(dto: CreateLeadDto, userId: string) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(
        'El lead necesita al menos un teléfono o un email',
      );
    }
    const externalId = `panel-${randomUUID()}`;
    const result = await this.leads.ingest({
      externalId,
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      source: dto.source ?? 'panel',
      campaign: dto.campaign,
      preferredChannel: dto.preferredChannel,
      timezone: dto.timezone,
      metadata: dto.metadata,
    } as IncomingLeadDto);

    await this.audit.record({
      userId,
      action: 'create_lead',
      entity: 'Lead',
      entityId: result.leadId,
      newValue: { externalId, name: dto.name, phone: dto.phone },
    });
    return this.leads.getById(result.leadId);
  }

  /**
   * Edición manual de la ficha. Los cambios de estado y calificación pasan por
   * `LeadsService` para que el CRM del cliente (si tiene uno conectado) se
   * entere igual que cuando los hace el agente.
   */
  async updateLead(leadId: string, dto: UpdateLeadDto, userId: string) {
    const before = await this.leads.getById(leadId);

    if (dto.status && dto.status !== before.status) {
      await this.leads.updateStatus(leadId, dto.status);
    }
    if (dto.qualification && dto.qualification !== before.qualification) {
      await this.leads.setQualification(
        leadId,
        dto.qualification,
        dto.qualificationReason ?? 'Calificado manualmente desde el panel',
      );
    }

    const data: Prisma.LeadUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.campaign !== undefined) data.campaign = dto.campaign;
    if (dto.preferredChannel !== undefined) {
      data.preferredChannel = dto.preferredChannel;
    }
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.metadata !== undefined) {
      data.metadata = dto.metadata as Prisma.InputJsonValue;
    }
    if (dto.nextActionAt !== undefined) {
      data.nextActionAt = dto.nextActionAt ? new Date(dto.nextActionAt) : null;
    }
    if (dto.nextActionType !== undefined) {
      data.nextActionType = dto.nextActionType;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.db.lead.update({ where: { id: leadId }, data });
    }

    await this.audit.record({
      userId,
      action: 'update_lead',
      entity: 'Lead',
      entityId: leadId,
      previousValue: {
        name: before.name,
        phone: before.phone,
        email: before.email,
        status: before.status,
        qualification: before.qualification,
      },
      newValue: { ...dto } as Prisma.InputJsonValue,
    });
    return this.leads.getById(leadId);
  }

  /**
   * Notas internas del equipo sobre un lead. Las últimas también se le pasan
   * al agente como contexto (ver `ContextBuilder.workContext`), marcadas como
   * internas: nunca se las lee al cliente.
   */
  async listNotes(leadId: string) {
    const notes = await this.prisma.db.leadNote.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (notes.length === 0) {
      return [];
    }
    const authorIds = [
      ...new Set(
        notes.map((n) => n.authorId).filter((id): id is string => !!id),
      ),
    ];
    const authors = await this.prisma.raw.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(authors.map((a) => [a.id, a]));
    return notes.map((note) => ({
      ...note,
      authorName: note.authorId
        ? (byId.get(note.authorId)?.name ??
          byId.get(note.authorId)?.email ??
          null)
        : null,
    }));
  }

  async addNote(leadId: string, body: string, userId: string) {
    await this.leads.getById(leadId); // valida pertenencia al tenant
    const note = await this.prisma.db.leadNote.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        leadId,
        body,
        authorId: userId,
      },
    });
    await this.audit.record({
      userId,
      action: 'add_lead_note',
      entity: 'LeadNote',
      entityId: note.id,
      newValue: { leadId, body },
    });
    return note;
  }

  async deleteNote(noteId: string, userId: string) {
    const note = await this.prisma.db.leadNote.findFirst({
      where: { id: noteId },
    });
    if (!note) {
      throw new NotFoundException('Nota no encontrada');
    }
    await this.prisma.db.leadNote.delete({ where: { id: noteId } });
    await this.audit.record({
      userId,
      action: 'delete_lead_note',
      entity: 'LeadNote',
      entityId: noteId,
      previousValue: { leadId: note.leadId, body: note.body },
    });
    return { deleted: true };
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
   * Edita a mano la memoria del lead. Es deliberado que se pueda: el agente la
   * escribe solo, y el equipo tiene que poder corregir algo mal deducido sin
   * esperar a que se corrija en la siguiente conversación.
   */
  async updateMemory(leadId: string, dto: UpdateLeadMemoryDto, userId: string) {
    await this.leads.getById(leadId); // valida pertenencia al tenant
    const antes = await this.memory.get(leadId);

    if (dto.summary !== undefined) {
      await this.memory.setSummary(leadId, dto.summary);
    }
    if (dto.olvidar) {
      await this.memory.forgetFact(leadId, dto.olvidar);
    }
    if (dto.clave && dto.valor) {
      await this.memory.rememberFact(leadId, dto.clave, dto.valor);
    }

    const despues = await this.memory.get(leadId);
    await this.audit.record({
      userId,
      action: 'update_lead_memory',
      entity: 'LeadMemory',
      entityId: leadId,
      previousValue: {
        summary: antes.summary,
        facts: antes.facts,
      } as unknown as Prisma.InputJsonValue,
      newValue: {
        summary: despues.summary,
        facts: despues.facts,
      } as unknown as Prisma.InputJsonValue,
    });
    return despues;
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
