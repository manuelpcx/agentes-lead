import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Direction, Lead, LeadStatus, Prisma } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { InteractionsService } from '../interactions/interactions.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { IncomingLeadDto } from '../webhooks/dto/incoming-lead.dto';

/** Resultado de una ingesta idempotente. */
export interface IngestResult {
  leadId: string;
  /** true si se creó; false si ya existía y se actualizó. */
  created: boolean;
}

@Injectable()
export class LeadsService {
  private readonly firstContactDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly interactions: InteractionsService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.firstContactDelayMs =
      config.get('FOLLOWUP_FIRST_CONTACT_DELAY_MIN', { infer: true }) * 60_000;
  }

  /**
   * Ingesta idempotente por `(companyId, externalId)`: si el lead no existe lo
   * crea en estado NUEVO y le asigna el agente por defecto; si ya existe,
   * actualiza sus datos. En ambos casos registra una Interaction (nunca
   * duplica el lead). El `companyId` lo fuerza la extensión multi-tenant.
   */
  async ingest(payload: IncomingLeadDto): Promise<IngestResult> {
    const existing = await this.prisma.db.lead.findFirst({
      where: { externalId: payload.externalId },
      select: { id: true },
    });
    if (existing) {
      return this.applyUpdate(existing.id, payload);
    }

    try {
      return await this.applyCreate(payload);
    } catch (error) {
      // Carrera: otro proceso creó el lead entre el find y el create.
      if (this.isUniqueViolation(error)) {
        const found = await this.prisma.db.lead.findFirst({
          where: { externalId: payload.externalId },
          select: { id: true },
        });
        if (found) {
          return this.applyUpdate(found.id, payload);
        }
      }
      throw error;
    }
  }

  /** Busca un lead por su `externalId` dentro de la empresa activa. */
  async findByExternalId(externalId: string): Promise<Lead | null> {
    return this.prisma.db.lead.findFirst({ where: { externalId } });
  }

  /**
   * Busca un lead por teléfono o lo crea (mensaje entrante de WhatsApp de un
   * número no registrado). Le asigna el agente por defecto y estado NUEVO.
   */
  async findOrCreateByPhone(phone: string, message?: string): Promise<Lead> {
    const existing = await this.prisma.db.lead.findFirst({ where: { phone } });
    if (existing) {
      return existing;
    }
    const companyId = TenantContext.requireCompanyId();
    // Lead nuevo por WhatsApp: enruta por canal/estado y, si hay mensaje y LLM,
    // por clasificador. Los leads existentes conservan su agente a cargo.
    const agentId = await this.agents.resolveDefaultAgentId(this.prisma.db, {
      channel: Channel.whatsapp,
      status: LeadStatus.NUEVO,
      message,
    });
    return this.prisma.db.lead.create({
      data: {
        companyId,
        agentId,
        externalId: `wa:${phone}`,
        phone,
        preferredChannel: Channel.whatsapp,
        status: LeadStatus.NUEVO,
      },
    });
  }

  /**
   * Registra un intento de seguimiento: incrementa el contador, fija
   * `lastContactedAt` y reprograma la próxima acción (Fase 4).
   */
  async recordFollowUpAttempt(
    leadId: string,
    nextActionAt: Date,
    nextActionType = 'seguimiento',
  ): Promise<Lead> {
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: {
        contactAttempts: { increment: 1 },
        lastContactedAt: new Date(),
        nextActionAt,
        nextActionType,
      },
    });
  }

  /** Cierra el lead como perdido (sin respuesta) y limpia la próxima acción. */
  async closeAsLost(leadId: string): Promise<Lead> {
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.CERRADO_PERDIDO, nextActionAt: null },
    });
  }

  /**
   * Marca un lead como en control humano: lo escala, lo pausa para el agente y
   * registra el motivo (usado por la herramienta escalarAHumano).
   */
  async escalateToHuman(leadId: string): Promise<Lead> {
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.ESCALADO_HUMANO, isPausedForHuman: true },
    });
  }

  /**
   * Reasigna el agente a cargo de un lead (traspaso, Fase 8). `Lead.agentId` es
   * la única fuente de verdad de quién manda, así que esto cierra la regla de
   * conflicto: a partir de aquí el nuevo agente es el que actúa.
   */
  async reassignAgent(leadId: string, agentId: string): Promise<Lead> {
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: { agentId },
    });
  }

  /** Obtiene un lead por id (aislado por tenant) o lanza 404. */
  async getById(leadId: string): Promise<Lead> {
    const lead = await this.prisma.db.lead.findFirst({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException('Lead no encontrado');
    }
    return lead;
  }

  /** Lista los leads de la empresa activa filtrando por estado (opcional). */
  async listByStatus(status?: LeadStatus): Promise<Lead[]> {
    return this.prisma.db.lead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Actualiza el estado del embudo de un lead. */
  async updateStatus(leadId: string, status: LeadStatus): Promise<Lead> {
    await this.getById(leadId); // valida pertenencia al tenant
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: { status },
    });
  }

  /** Programa la próxima acción de seguimiento (usado desde Fase 4). */
  async scheduleNextAction(
    leadId: string,
    nextActionAt: Date,
    nextActionType: string,
  ): Promise<Lead> {
    await this.getById(leadId);
    return this.prisma.db.lead.update({
      where: { id: leadId },
      data: { nextActionAt, nextActionType },
    });
  }

  // ─────────────────────── privados ───────────────────────

  private async applyCreate(payload: IncomingLeadDto): Promise<IngestResult> {
    return this.prisma.db.$transaction(async (tx) => {
      // Enrutamiento determinista al crear (aún no hay mensaje del cliente).
      const agentId = await this.agents.resolveDefaultAgentId(tx, {
        channel: payload.preferredChannel,
        status: LeadStatus.NUEVO,
      });
      const lead = await tx.lead.create({
        data: {
          companyId: TenantContext.requireCompanyId(),
          agentId,
          externalId: payload.externalId,
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          source: payload.source,
          campaign: payload.campaign,
          preferredChannel: payload.preferredChannel as Channel | undefined,
          timezone: payload.timezone,
          metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
          status: LeadStatus.NUEVO,
          // Programa el primer contacto proactivo (Fase 4 lo ejecuta). Con un
          // pequeño retardo configurable para responder rápido sin parecer bot.
          nextActionAt: new Date(Date.now() + this.firstContactDelayMs),
          nextActionType: 'primer_contacto',
        },
        select: { id: true },
      });

      await this.interactions.register(
        {
          leadId: lead.id,
          channel: Channel.system,
          direction: Direction.inbound,
          content: `Lead capturado desde ${payload.source ?? 'origen desconocido'}`,
          agentId: null,
          metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
        },
        tx,
      );

      return { leadId: lead.id, created: true };
    });
  }

  private async applyUpdate(
    leadId: string,
    payload: IncomingLeadDto,
  ): Promise<IngestResult> {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: this.buildUpdateData(payload),
      });

      await this.interactions.register(
        {
          leadId,
          channel: Channel.system,
          direction: Direction.inbound,
          content: `Lead reingresado (evento repetido) desde ${
            payload.source ?? 'origen desconocido'
          }`,
          agentId: null,
          metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
        },
        tx,
      );

      return { leadId, created: false };
    });
  }

  /** Construye el `data` de actualización solo con los campos presentes. */
  private buildUpdateData(payload: IncomingLeadDto): Prisma.LeadUpdateInput {
    const data: Prisma.LeadUpdateInput = {};
    if (payload.name !== undefined) data.name = payload.name;
    if (payload.phone !== undefined) data.phone = payload.phone;
    if (payload.email !== undefined) data.email = payload.email;
    if (payload.source !== undefined) data.source = payload.source;
    if (payload.campaign !== undefined) data.campaign = payload.campaign;
    if (payload.preferredChannel !== undefined) {
      data.preferredChannel = payload.preferredChannel as Channel;
    }
    if (payload.timezone !== undefined) data.timezone = payload.timezone;
    if (payload.metadata !== undefined) {
      data.metadata = payload.metadata as Prisma.InputJsonValue;
    }
    return data;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
