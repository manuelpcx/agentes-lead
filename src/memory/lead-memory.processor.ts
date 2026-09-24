import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { QUEUE_LEAD_MEMORY } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { LeadMemoryService } from './lead-memory.service';

/** Payload del job de refresco de memoria. */
export interface LeadMemoryJobData {
  companyId: string;
  leadId: string;
  correlationId?: string;
}

/**
 * Rehace el resumen del lead fuera del turno. Va en su propia cola a
 * propósito: es una llamada extra al modelo, y hacerla dentro del turno le
 * sumaría segundos a la respuesta que el cliente está esperando.
 *
 * Concurrencia baja: es trabajo de fondo, no tiene que competir con los turnos
 * por el cupo de la API.
 */
@Processor(QUEUE_LEAD_MEMORY, { concurrency: 2 })
export class LeadMemoryProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadMemoryProcessor.name);

  constructor(private readonly memory: LeadMemoryService) {
    super();
  }

  async process(job: Job<LeadMemoryJobData>): Promise<void> {
    const { companyId, leadId, correlationId } = job.data;
    await TenantContext.run(
      { companyId, correlationId: correlationId || randomUUID() },
      async () => {
        try {
          await this.memory.refreshSummary(leadId);
        } catch (error) {
          this.logger.warn(
            `Refresco de memoria fallido (leadId=${leadId}): ${(error as Error).message}`,
          );
        }
      },
    );
  }
}
