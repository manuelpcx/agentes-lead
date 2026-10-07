import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { QUEUE_LEAD_FOLLOWUP } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { FollowUpService } from './followup.service';
import { FollowUpJobData } from './followup.job';

/** Worker de seguimiento: abre el contexto de tenant y delega al servicio. */
@Processor(QUEUE_LEAD_FOLLOWUP, { concurrency: 3 })
export class FollowUpProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowUpProcessor.name);

  constructor(private readonly followup: FollowUpService) {
    super();
  }

  async process(job: Job<FollowUpJobData>): Promise<void> {
    const { companyId, leadId, correlationId } = job.data;
    await TenantContext.run(
      { companyId, correlationId: correlationId || randomUUID() },
      async () => {
        try {
          await this.followup.processFollowUp(leadId);
        } catch (error) {
          this.logger.error(
            `Fallo en seguimiento (leadId=${leadId}): ${(error as Error).message}`,
          );
          // Agotados los reintentos, la próxima acción seguiría vencida y el
          // cron la reencolaría cada 2 min contra un proveedor caído. Se
          // posterga para reintentar más tarde, con el motivo a la vista.
          if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
            await this.followup
              .deferAfterFailure(leadId, (error as Error).message)
              .catch((e: Error) =>
                this.logger.error(
                  `No se pudo postergar el seguimiento (leadId=${leadId}): ${e.message}`,
                ),
              );
          }
          throw error;
        }
      },
    );
  }
}
