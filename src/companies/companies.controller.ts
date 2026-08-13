import { Body, Controller, Post } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';

/**
 * Alta de empresas (tenant raíz). NOTA: en Fase 1 este endpoint queda sin
 * autenticación de administrador; se protegerá al construir el panel (Fase 7).
 */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  async create(@Body() dto: CreateCompanyDto) {
    const { company, webhookSecret } = await this.companies.create(dto);
    // Nunca devolvemos el secreto cifrado; sí el secreto en claro una vez.
    const { webhookSecret: _omit, ...safeCompany } = company;
    return {
      company: safeCompany,
      webhookSecret,
      aviso:
        'Guarda el webhookSecret ahora: no volverá a mostrarse. Úsalo para ' +
        'firmar (HMAC-SHA256) el cuerpo de POST /webhooks/lead.',
    };
  }
}
