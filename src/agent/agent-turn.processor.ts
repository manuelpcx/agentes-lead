import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { AgentRunner } from './agent-runner.service';
import { AgentTurnJobData } from './agent-turn.job';

/**
 * Worker que ejecuta un turno del agente. Abre el `TenantContext` con el
 * `companyId` del job para aislar todas las operaciones. Concurrencia 1 por
 * lead-turn para no pisar mensajes del mismo lead.
 */
@Processor(QUEUE_AGENT_TURN, { concurrency: 4 })
export class AgentTurnProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentTurnProcessor.name);

  constructor(private readonly runner: AgentRunner) {
    super();
  }

  async process(job: Job<AgentTurnJobData>): Promise<void> {
    const { companyId, leadId, correlationId } = job.data;
    await TenantContext.run(
      { companyId, correlationId: correlationId || randomUUID() },
      async () => {
        try {
          await this.runner.runTurn(leadId);
        } catch (error) {
          this.logger.error(
            `Fallo en turno del agente (leadId=${leadId}): ${(error as Error).message}`,
          );
          throw error;
        }
      },
    );
  }
}
