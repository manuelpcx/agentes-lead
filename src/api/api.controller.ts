import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AppointmentStatus, PanelRole } from '@prisma/client';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentMembership, CurrentUser } from '../auth/current-user.decorator';
import { AuthMembership, AuthUser } from '../auth/auth.types';
import { PanelService } from '../panel/panel.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AgentsService } from '../agents/agents.service';
import { CompaniesService } from '../companies/companies.service';
import { MetricsService } from '../improvement/metrics.service';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import {
  CreateLeadDto,
  ListLeadsQuery,
  UpdateLeadDto,
} from '../panel/dto/lead.dto';
import { CreateLeadNoteDto } from '../panel/dto/lead-note.dto';
import {
  AppointmentRangeQuery,
  CreateAppointmentDto,
} from '../panel/dto/appointment.dto';

/** Tope de días de métricas que se pueden pedir de una vez. */
const MAX_METRIC_DAYS = 90;

/**
 * Superficie pública para integraciones sin usuario humano delante — hoy, el
 * servidor MCP (`mcp/`). Se autentica con llave de API en vez de JWT.
 *
 * Es una lista **curada a mano**, no un espejo del panel. En particular NO
 * expone `POST /panel/leads/:id/reply` ni nada que mande un mensaje a una
 * persona real: al otro lado hay un modelo de lenguaje corriendo en el
 * computador de alguien, y una instrucción mal leída no puede terminar en un
 * WhatsApp a un cliente. Escribir notas, crear leads y agendar sí, porque son
 * reversibles y no salen de la empresa.
 */
@Controller('api/v1')
@UseGuards(ApiKeyGuard, RolesGuard)
// Por llave de API. Un cliente MCP normal hace unas pocas llamadas por minuto.
@RateLimit({ limit: 300, windowSec: 60, scope: 'auth' })
export class ApiController {
  constructor(
    private readonly panel: PanelService,
    private readonly appointments: AppointmentsService,
    private readonly agents: AgentsService,
    private readonly companies: CompaniesService,
    private readonly metrics: MetricsService,
  ) {}

  /** Diagnóstico: a qué empresa entró la llave y con qué permisos. */
  @Get('me')
  async me(@CurrentMembership() membership: AuthMembership) {
    const company = await this.companies.findById(membership.companyId);
    return {
      companyId: membership.companyId,
      // Nunca el objeto completo: `Company` trae el secreto de webhooks.
      companyName: company?.name ?? null,
      timezone: company?.timezone ?? null,
      role: membership.role,
      canWrite: membership.role !== PanelRole.SOLO_LECTURA,
    };
  }

  // ─────────────────────────── leads ───────────────────────────

  @Get('leads')
  listLeads(@Query() query: ListLeadsQuery) {
    return this.panel.listLeads(query);
  }

  @Get('leads/:id')
  getLead(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.panel.getLeadDetail(id);
  }

  @Post('leads')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  createLead(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.panel.createLead(dto, user.userId);
  }

  @Patch('leads/:id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  updateLead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.updateLead(id, dto, user.userId);
  }

  @Post('leads/:id/notes')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  addNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateLeadNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.addNote(id, dto.body, user.userId);
  }

  // ─────────────────────────── agenda ───────────────────────────

  @Get('appointments')
  listAppointments(@Query() query: AppointmentRangeQuery) {
    return this.appointments.listInRange(
      new Date(query.from),
      new Date(query.to),
    );
  }

  @Post('appointments')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  createAppointment(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointments.schedule({
      leadId: dto.leadId,
      title: dto.title,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      location: dto.location,
      notes: dto.notes,
      createdBy: user.userId,
    });
  }

  @Post('appointments/:id/cancel')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  cancelAppointment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointments.update(
      id,
      { status: AppointmentStatus.CANCELADA },
      user.userId,
    );
  }

  // ─────────────────────────── agentes y métricas ───────────────────────────

  /** Agentes de la empresa, sin sus prompts (eso es otra pantalla). */
  @Get('agents')
  async listAgents() {
    const agents = await this.agents.list();
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      channels: a.channels,
      leadStates: a.leadStates,
      isDefault: a.isDefault,
      isActive: a.isActive,
    }));
  }

  @Get('metrics')
  metrics_(
    @CurrentMembership() membership: AuthMembership,
    @Query('days') days?: string,
  ) {
    const n = Number(days ?? 7);
    if (!Number.isFinite(n) || n < 1 || n > MAX_METRIC_DAYS) {
      throw new BadRequestException(
        `days debe ser un número entre 1 y ${MAX_METRIC_DAYS}`,
      );
    }
    const to = new Date();
    const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
    return this.metrics.query(membership.companyId, from, to);
  }
}
