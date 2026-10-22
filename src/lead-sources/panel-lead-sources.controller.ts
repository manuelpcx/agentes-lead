import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { SaveLeadSourcesDto } from './dto/save-lead-sources.dto';
import { LeadSourcesService } from './lead-sources.service';

/**
 * Fuentes de leads por API. Configurarlas es del dueño (son URLs y un token
 * de un sistema externo); cargar puede hacerlo también un operador.
 */
@Controller('panel/lead-sources')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelLeadSourcesController {
  constructor(private readonly sources: LeadSourcesService) {}

  /** Lo que ve el panel (sin el token): qué hay configurado y si el botón va. */
  @Get()
  ver() {
    return this.sources.ver();
  }

  @Put()
  @Roles(PanelRole.OWNER)
  guardar(@Body() dto: SaveLeadSourcesDto, @CurrentUser() user: AuthUser) {
    return this.sources.guardar(dto, user.userId);
  }

  /** El botón "Cargar nuevos leads". */
  @Post('load')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  // Cada clic llama a la API del cliente: no puede ser un martillo.
  @RateLimit({ limit: 6, windowSec: 60, scope: 'auth' })
  cargar(@CurrentUser() user: AuthUser) {
    return this.sources.cargar(user.userId);
  }
}
