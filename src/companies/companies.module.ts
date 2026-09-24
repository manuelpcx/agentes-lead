import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { AgentsModule } from '../agents/agents.module';

/**
 * Empresas (tenant raíz). Sin controlador propio a propósito: el alta de
 * empresas es `POST /auth/register-company` (crea también al OWNER). El viejo
 * `POST /companies` público creaba tenants sin autenticación.
 */
@Module({
  imports: [AgentsModule],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
