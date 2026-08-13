import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FactCategory, PanelRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { AgentsService } from '../agents/agents.service';
import { KnowledgeDocumentService } from '../knowledge/knowledge-document.service';
import { StructuredFactsService } from '../knowledge/structured-facts.service';
import { SemanticSearchService } from '../knowledge/semantic-search.service';
import { OnboardingService } from '../knowledge/onboarding.service';
import { CreateDocumentDto } from '../knowledge/dto/create-document.dto';
import { UpdateDocumentDto } from '../knowledge/dto/update-document.dto';
import { SearchKnowledgeDto } from '../knowledge/dto/search-knowledge.dto';
import { UpsertFactDto } from '../knowledge/dto/upsert-fact.dto';
import { OnboardingDto } from '../knowledge/dto/onboarding.dto';
import { UpdateCompanyConfigDto } from './dto/update-company-config.dto';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

/**
 * API de administración del panel (Fase 7B): agentes, gestión de conocimiento,
 * configuración de empresa y onboarding — todo con JWT + membresía (a
 * diferencia de las rutas /knowledge y /onboarding, que usan HMAC).
 */
@Controller('panel')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
    private readonly documents: KnowledgeDocumentService,
    private readonly facts: StructuredFactsService,
    private readonly search: SemanticSearchService,
    private readonly onboarding: OnboardingService,
  ) {}

  // ── Agentes (Fase 8) ──
  @Get('agents')
  listAgents() {
    return this.agents.list();
  }

  /** Métricas comparadas por agente. Ruta fija ANTES de cualquier `:id`. */
  @Get('agents/metrics')
  agentMetrics() {
    return this.agents.metrics();
  }

  @Post('agents')
  @Roles(PanelRole.OWNER)
  async createAgent(
    @Body() dto: CreateAgentDto,
    @CurrentUser() user: AuthUser,
  ) {
    const agent = await this.agents.create(dto);
    await this.audit.record({
      userId: user.userId,
      action: 'create_agent',
      entity: 'Agent',
      entityId: agent.id,
      newValue: dto as unknown as Prisma.InputJsonValue,
    });
    return agent;
  }

  @Patch('agents/:id')
  @Roles(PanelRole.OWNER)
  async updateAgent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: AuthUser,
  ) {
    const agent = await this.agents.update(id, dto);
    await this.audit.record({
      userId: user.userId,
      action: 'update_agent',
      entity: 'Agent',
      entityId: id,
      newValue: dto as unknown as Prisma.InputJsonValue,
    });
    return agent;
  }

  @Delete('agents/:id')
  @Roles(PanelRole.OWNER)
  async deactivateAgent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const agent = await this.agents.deactivate(id);
    await this.audit.record({
      userId: user.userId,
      action: 'deactivate_agent',
      entity: 'Agent',
      entityId: id,
    });
    return agent;
  }

  /** Traspasos recientes entre agentes. */
  @Get('handoffs')
  handoffs(@Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 20;
    return this.agents.handoffs(Number.isFinite(n) ? n : 20);
  }

  // ── Configuración de empresa ──
  @Get('company')
  async getCompany() {
    const company = await this.prisma.raw.company.findUnique({
      where: { id: TenantContext.requireCompanyId() },
      select: {
        id: true,
        name: true,
        rut: true,
        timezone: true,
        businessHours: true,
        channelsConfig: true,
        isActive: true,
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }
    return company;
  }

  @Patch('company')
  @Roles(PanelRole.OWNER)
  async updateCompany(
    @Body() dto: UpdateCompanyConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    const companyId = TenantContext.requireCompanyId();
    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.businessHours !== undefined) {
      data.businessHours = dto.businessHours as Prisma.InputJsonValue;
    }
    if (dto.channelsConfig !== undefined) {
      data.channelsConfig = dto.channelsConfig as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.raw.company.update({
      where: { id: companyId },
      data,
      select: {
        id: true,
        name: true,
        timezone: true,
        businessHours: true,
        channelsConfig: true,
      },
    });
    await this.audit.record({
      userId: user.userId,
      action: 'update_company_config',
      entity: 'Company',
      entityId: companyId,
      newValue: dto as Prisma.InputJsonValue,
    });
    return updated;
  }

  // ── Gestión de conocimiento: documentos ──
  @Get('knowledge/documents')
  listDocuments() {
    return this.documents.list();
  }

  @Get('knowledge/documents/:id')
  getDocument(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.getById(id);
  }

  @Post('knowledge/documents')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  createDocument(@Body() dto: CreateDocumentDto) {
    return this.documents.create(dto);
  }

  @Patch('knowledge/documents/:id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  updateDocument(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(id, dto);
  }

  @Delete('knowledge/documents/:id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  deactivateDocument(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.deactivate(id);
  }

  @Post('knowledge/search')
  searchKnowledge(@Body() dto: SearchKnowledgeDto) {
    return this.search.search(dto.query, {
      topK: dto.topK,
      minSimilarity: dto.minSimilarity,
    });
  }

  // ── Gestión de conocimiento: hechos estructurados ──
  @Get('knowledge/facts')
  listFacts(@Query('category') category?: FactCategory) {
    return this.facts.list(category);
  }

  @Post('knowledge/facts')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  upsertFact(@Body() dto: UpsertFactDto) {
    return this.facts.upsert(dto);
  }

  @Delete('knowledge/facts/:id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  deactivateFact(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.facts.deactivate(id);
  }

  // ── Onboarding (autoservicio) ──
  @Post('onboarding')
  @Roles(PanelRole.OWNER)
  runOnboarding(@Body() dto: OnboardingDto) {
    return this.onboarding.run(dto);
  }
}
