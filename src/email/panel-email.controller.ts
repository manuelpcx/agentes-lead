import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PanelRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ManagedEmailService } from './managed-email.service';
import { AddEmailDomainDto, UpdateEmailSenderDto } from './dto/email-panel.dto';

/**
 * Correo gestionado de la empresa (Integraciones → Correo): remitente y
 * dominio propio, que se da de alta en la cuenta de Resend de la plataforma.
 */
@Controller('panel/email')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelEmailController {
  constructor(private readonly managed: ManagedEmailService) {}

  /** Estado: remitente, dominio y sus registros DNS, por dónde sale el correo. */
  @Get()
  status() {
    return this.managed.status();
  }

  @Put('sender')
  @Roles(PanelRole.OWNER)
  updateSender(@Body() dto: UpdateEmailSenderDto) {
    return this.managed.updateSender(dto);
  }

  /** Da de alta el dominio en Resend y devuelve los registros DNS a crear. */
  @Post('domain')
  @Roles(PanelRole.OWNER)
  // Crea un recurso en una cuenta de terceros compartida: nada de martillarla.
  @RateLimit({ limit: 5, windowSec: 60, scope: 'auth' })
  addDomain(@Body() dto: AddEmailDomainDto) {
    return this.managed.addDomain(dto.domain);
  }

  @Post('domain/verify')
  @Roles(PanelRole.OWNER)
  @RateLimit({ limit: 10, windowSec: 60, scope: 'auth' })
  verifyDomain() {
    return this.managed.verifyDomain();
  }

  @Delete('domain')
  @Roles(PanelRole.OWNER)
  removeDomain() {
    return this.managed.removeDomain();
  }
}
