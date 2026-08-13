import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentMembership } from '../auth/current-user.decorator';
import { AuthMembership, AuthUser } from '../auth/auth.types';
import { KnowledgeGapsService } from './knowledge-gaps.service';
import { ExampleLibraryService } from './example-library.service';
import { PromptVersionsService } from './prompt-versions.service';
import { MetricsService } from './metrics.service';
import { ApproveGapDto } from './dto/approve-gap.dto';

/**
 * Cola de aprobación + métricas del panel (Fase 6). Todo bajo JWT + membresía.
 * Nada entra a producción sin aprobación humana explícita.
 */
@Controller('panel')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelImprovementController {
  constructor(
    private readonly gaps: KnowledgeGapsService,
    private readonly examples: ExampleLibraryService,
    private readonly promptVersions: PromptVersionsService,
    private readonly metrics: MetricsService,
  ) {}

  // ── Vacíos de conocimiento ──
  @Get('knowledge-gaps')
  listGaps() {
    return this.gaps.listPending();
  }

  @Post('knowledge-gaps/:id/approve')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  approveGap(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveGapDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.gaps.approve(id, dto.answer, user.userId);
  }

  @Post('knowledge-gaps/:id/reject')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  rejectGap(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.gaps.reject(id, user.userId);
  }

  // ── Biblioteca de ejemplos ──
  @Get('examples')
  listExamples() {
    return this.examples.listPending();
  }

  @Post('examples/:id/approve')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  approveExample(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.examples.approve(id);
  }

  // ── Versiones de prompt ──
  @Get('prompt-versions')
  listPromptVersions(@Query('agentId', new ParseUUIDPipe()) agentId: string) {
    return this.promptVersions.listForAgent(agentId);
  }

  @Post('prompt-versions/:id/activate')
  @Roles(PanelRole.OWNER)
  activatePromptVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.promptVersions.activate(id, user.userId);
  }

  // ── Métricas ──
  @Get('metrics')
  metricsQuery(
    @CurrentMembership() membership: AuthMembership,
    @Query('days') days?: string,
  ) {
    const n = Math.min(Math.max(Number(days) || 7, 1), 90);
    const to = new Date();
    const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
    return this.metrics.query(membership.companyId, from, to);
  }

  @Post('metrics/recompute')
  @Roles(PanelRole.OWNER)
  async recomputeMetrics(@CurrentMembership() membership: AuthMembership) {
    await this.metrics.computeDaily(membership.companyId, new Date());
    return { ok: true };
  }
}
