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
import { LeadStatus, PanelRole } from '@prisma/client';
import { PanelService } from './panel.service';
import { ReplyDto } from './dto/reply.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

/**
 * API del panel. Todas las rutas requieren JWT + membresía en la empresa
 * seleccionada (`X-Company-Id`). Las acciones de escritura exigen rol
 * OWNER/OPERADOR; SOLO_LECTURA solo puede leer.
 */
@Controller('panel')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelController {
  constructor(private readonly panel: PanelService) {}

  @Get('leads')
  listLeads(@Query('status') status?: LeadStatus) {
    return this.panel.listLeads(status);
  }

  @Get('leads/:id')
  getLead(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.panel.getLeadDetail(id);
  }

  @Post('leads/:id/take-control')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  takeControl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.takeControl(id, user.userId);
  }

  @Post('leads/:id/release-control')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  releaseControl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.releaseControl(id, user.userId);
  }

  @Post('leads/:id/reply')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  reply(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.panel.humanReply(id, dto.text, user.userId);
  }
}
