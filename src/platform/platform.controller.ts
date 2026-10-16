import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { PlatformService } from './platform.service';
import { CreateDemoCompanyDto } from './dto/create-demo-company.dto';
import { SetCompanyActiveDto } from './dto/set-company-active.dto';
import { SetVoiceLimitDto } from './dto/set-voice-limit.dto';
import { AlertsQueryService } from '../alerts/alerts-query.service';

/**
 * Mantenedor de la plataforma: el listado de clientes y el alta de cuentas de
 * demostración. Detrás de `PlatformAdminGuard`, que es la única puerta del
 * sistema que ve más allá de una empresa.
 *
 * El límite de tasa es de la clase entera y a propósito: si estas credenciales
 * se filtran, que no sirvan para barrer la base de clientes de un tirón.
 */
@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@RateLimit({ limit: 60, windowSec: 60, scope: 'auth' })
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly alerts: AlertsQueryService,
  ) {}

  /** Incidentes de proveedores: abiertos y cerrados en los últimos 7 días. */
  @Get('incidents')
  listIncidents() {
    return this.alerts.listForPlatform();
  }

  /** Clientes con su uso: qué activaron y cuándo fue su última actividad. */
  @Get('companies')
  listCompanies() {
    return this.platform.listCompanies();
  }

  /** Ficha de un cliente: configuración y quién tiene acceso. */
  @Get('companies/:id')
  getCompany(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.platform.getCompany(id);
  }

  /**
   * Crea una cuenta de demostración. Devuelve la contraseña y el secreto de
   * webhook UNA sola vez: no se vuelven a mostrar.
   */
  @Post('companies/demo')
  createDemo(@Body() dto: CreateDemoCompanyDto, @CurrentUser() user: AuthUser) {
    return this.platform.createDemoCompany(dto, user.userId);
  }

  /** Activa o desactiva una empresa entera. */
  @Patch('companies/:id/active')
  setActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetCompanyActiveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.setCompanyActive(id, dto.isActive, user.userId);
  }

  /** Tope mensual de minutos de voz gestionada de una empresa. */
  @Patch('companies/:id/voice-limit')
  setVoiceLimit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetVoiceLimitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.platform.setVoiceLimit(id, dto.minutes, user.userId);
  }
}
