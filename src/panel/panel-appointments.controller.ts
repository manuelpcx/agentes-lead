import {
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
import { AppointmentsService } from '../appointments/appointments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import {
  AppointmentRangeQuery,
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

/**
 * Calendario del panel: las mismas citas que agenda el agente, pero
 * consultables y editables por un humano.
 */
@Controller('panel/appointments')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@Query() query: AppointmentRangeQuery) {
    return this.appointments.listInRange(
      new Date(query.from),
      new Date(query.to),
    );
  }

  @Post()
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: AuthUser) {
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

  @Patch(':id')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointments.update(
      id,
      {
        title: dto.title,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        location: dto.location,
        notes: dto.notes,
        status: dto.status,
      },
      user.userId,
    );
  }

  @Post(':id/cancel')
  @Roles(PanelRole.OWNER, PanelRole.OPERADOR)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointments.update(
      id,
      { status: AppointmentStatus.CANCELADA },
      user.userId,
    );
  }
}
