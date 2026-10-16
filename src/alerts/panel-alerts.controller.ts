import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { TenantContext } from '../common/tenant/tenant-context';
import { AlertsQueryService } from './alerts-query.service';

/** Avisos de proveedores para la empresa activa (cualquier rol). */
@Controller('panel/alerts')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelAlertsController {
  constructor(private readonly alerts: AlertsQueryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.alerts.forCompany(
      TenantContext.requireCompanyId(),
      user.userId,
    );
  }
}
