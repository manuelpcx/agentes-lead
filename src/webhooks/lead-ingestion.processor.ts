import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { LeadsService, IngestResult } from '../leads/leads.service';
import { QUEUE_LEAD_INGESTION } from '../queue/queue.constants';
import { LeadIngestionJobData } from './lead-ingestion.job';
import { TenantContext } from '../common/tenant/tenant-context';

/**
 * Worker de ingesta de leads. Corre fuera del ciclo HTTP, así que abre él mismo
 * el `TenantContext` con el `companyId` del job para que la extensión
 * multi-tenant de Prisma aísle todas las escrituras. Fase 1: sin LLM.
 *
 * Concurrencia 1 para simplificar la idempotencia bajo eventos repetidos; se
 * puede subir cuando el upsert por constraint esté probado bajo carga.
 */
@Processor(QUEUE_LEAD_INGESTION, { concurrency: 1 })
export class LeadIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadIngestionProcessor.name);

  constructor(private readonly leads: LeadsService) {
    super();
  }

  async process(job: Job<LeadIngestionJobData>): Promise<IngestResult> {
    const { companyId, correlationId, payload } = job.data;

    return TenantContext.run(
      {
        companyId,
        correlationId: correlationId || randomUUID(),
      },
      async () => {
        const result = await this.leads.ingest(payload);
        this.logger.log(
          `Lead ${result.created ? 'creado' : 'actualizado'} desde ingesta ` +
            `(leadId=${result.leadId} externalId=${payload.externalId})`,
        );
        return result;
      },
    );
  }
}
