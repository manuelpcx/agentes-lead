import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

/**
 * Gestión de llaves de API desde el panel. Solo OWNER: una llave es acceso
 * permanente a los datos de la empresa, no es un ajuste más.
 */
@Controller('panel/api-keys')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
@Roles(PanelRole.OWNER)
export class PanelApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list() {
    return this.apiKeys.list();
  }

  /** Devuelve la llave en claro. Es la única vez que se puede leer. */
  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthUser) {
    return this.apiKeys.create({
      name: dto.name,
      role: dto.role,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdById: user.userId,
    });
  }

  @Delete(':id')
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.apiKeys.revoke(id, user.userId);
  }
}
