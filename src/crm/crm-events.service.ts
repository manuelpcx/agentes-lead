import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_CRM_EVENTS } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { CrmEventJob, CrmEventType } from './crm-event.types';

/**
 * Emite eventos hacia el CRM del cliente (BYO, canal 'crm'): cambios de
 * estado, promesas de pago, citas agendadas, etc. Encola la entrega (no
 * bloquea el turno del agente ni el flujo que lo dispara); el `CrmEventsProcessor`
 * hace el POST firmado. Sin integración de CRM configurada, es un no-op.
 */
@Injectable()
export class CrmEventsService {
  private readonly logger = new Logger(CrmEventsService.name);

  constructor(
    @InjectQueue(QUEUE_CRM_EVENTS) private readonly queue: Queue<CrmEventJob>,
    private readonly credentials: CredentialsService,
  ) {}

  async emit(params: {
    leadId: string;
    externalId?: string | null;
    event: CrmEventType;
    data: Record<string, unknown>;
  }): Promise<void> {
    const companyId = TenantContext.requireCompanyId();
    const cred = await this.credentials.get('crm');
    if (!cred?.isActive || !cred.secret || !cred.config.url) {
      return; // sin CRM configurado o inactivo: no hay a quién avisar
    }
    await this.queue.add('deliver', {
      companyId,
      leadId: params.leadId,
      externalId: params.externalId ?? null,
      event: params.event,
      data: params.data,
      occurredAt: new Date().toISOString(),
    });
    this.logger.log(
      `Evento CRM encolado: ${params.event} (leadId=${params.leadId})`,
    );
  }
}
