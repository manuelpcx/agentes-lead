import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IncomingLeadDto } from './dto/incoming-lead.dto';
import { LeadIngestionJobData } from './lead-ingestion.job';
import { QUEUE_LEAD_INGESTION } from '../queue/queue.constants';
import { CompanyAuthGuard } from '../common/tenant/company-auth.guard';
import { TenantContext } from '../common/tenant/tenant-context';

/**
 * Punto de entrada de leads desde n8n / integraciones externas. Responde 202
 * de inmediato (n8n no espera) y delega el trabajo real al worker BullMQ. El
 * DTO se valida con el `ValidationPipe` global; la empresa se autentica por
 * firma HMAC en `CompanyAuthGuard`.
 */
@Controller('webhooks')
@UseGuards(CompanyAuthGuard)
export class WebhooksController {
  constructor(
    @InjectQueue(QUEUE_LEAD_INGESTION)
    private readonly ingestionQueue: Queue<LeadIngestionJobData>,
  ) {}

  @Post('lead')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestLead(
    @Body() payload: IncomingLeadDto,
  ): Promise<{ accepted: true; externalId: string }> {
    const store = TenantContext.get();
    const companyId = store?.companyId ?? '';
    const correlationId = store?.correlationId ?? '';

    // Cada evento se encola (los repetidos deben ACTUALIZAR y registrar
    // interacción, no descartarse). La idempotencia real vive en la BD:
    // upsert por (companyId, externalId) en LeadsService.
    await this.ingestionQueue.add('ingest', {
      companyId,
      correlationId,
      payload,
    });

    return { accepted: true, externalId: payload.externalId };
  }
}
