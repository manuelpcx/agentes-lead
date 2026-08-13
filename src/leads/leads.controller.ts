import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';

/**
 * Endpoints de lectura de leads (para depuración / futuro panel). La ingesta
 * NO pasa por aquí, sino por `POST /webhooks/lead`. Todo va aislado por tenant.
 */
@Controller('leads')
@UseGuards(CompanyAuthGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@Query('status') status?: LeadStatus) {
    return this.leads.listByStatus(status);
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.leads.getById(id);
  }
}
