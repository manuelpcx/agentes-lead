import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FactCategory } from '@prisma/client';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { StructuredFactsService } from './structured-facts.service';
import { UpsertFactDto } from './dto/upsert-fact.dto';

/** Administración de hechos estructurados (precios, horarios, políticas...). */
@Controller('knowledge/facts')
@UseGuards(CompanyAuthGuard)
export class FactsController {
  constructor(private readonly facts: StructuredFactsService) {}

  @Post()
  upsert(@Body() dto: UpsertFactDto) {
    return this.facts.upsert(dto);
  }

  @Get()
  list(@Query('category') category?: FactCategory) {
    return this.facts.list(category);
  }

  /** Devuelve el hecho vigente para una clave (base de `consultarDato`). */
  @Get('current')
  async getCurrent(@Query('key') key: string) {
    const fact = await this.facts.getCurrent(key);
    if (!fact) {
      throw new NotFoundException(
        `No hay un hecho vigente para la clave "${key}"`,
      );
    }
    return fact;
  }

  @Delete(':id')
  deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.facts.deactivate(id);
  }
}
