import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_CRM_EVENTS } from '../queue/queue.constants';
import { CredentialsService } from '../integrations/credentials.service';
import { deliverCrmEvent } from './crm-delivery';
import { CrmEventJob } from './crm-event.types';

/**
 * Worker que entrega los eventos encolados por `CrmEventsService`. Resuelve
 * las credenciales de ESA empresa con `companyId` explícito (no hay
 * TenantContext de request aquí, es un job de cola) y hace el POST firmado.
 * Si falla, lanza para que BullMQ reintente (backoff exponencial, 5 intentos
 * — ver `DEFAULT_JOB_OPTIONS`); si la integración se desactivó entre el
 * `emit` y la entrega, descarta el job en silencio.
 */
@Processor(QUEUE_CRM_EVENTS, { concurrency: 5 })
export class CrmEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(CrmEventsProcessor.name);

  constructor(private readonly credentials: CredentialsService) {
    super();
  }

  async process(job: Job<CrmEventJob>): Promise<void> {
    const { companyId, event } = job.data;
    const cred = await this.credentials.getByCompanyId(companyId, 'crm');
    const url = cred?.config.url;
    if (!cred?.isActive || !cred.secret || typeof url !== 'string' || !url) {
      this.logger.warn(
        `CRM ya no está configurado para companyId=${companyId}: se descarta ${event}.`,
      );
      return;
    }

    const result = await deliverCrmEvent(url, cred.secret, job.data);
    if (!result.ok) {
      throw new Error(result.message); // BullMQ reintenta con backoff
    }
    this.logger.log(
      `Evento CRM entregado: ${event} (leadId=${job.data.leadId})`,
    );
  }
}
