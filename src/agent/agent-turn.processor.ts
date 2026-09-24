import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Direction } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { QUEUE_AGENT_TURN } from '../queue/queue.constants';
import { TenantContext } from '../common/tenant/tenant-context';
import { AgentRunner } from './agent-runner.service';
import { AgentTurnJobData } from './agent-turn.job';
import { CONVERSATION_CHANNELS } from './agent.constants';
import { TurnLockService } from './turn-lock.service';

/** Cuánto espera un job que encontró el lead ocupado antes de reintentar. */
export const LOCK_RETRY_MS = 5_000;

/**
 * Reintentos máximos ante un lead ocupado (≈2,5 min). Tiene que superar al TTL
 * del candado para que un turno colgado no haga perder el mensaje siguiente.
 */
export const MAX_LOCK_RETRIES = 30;

/** Piso del TTL del candado, por si `AGENT_TIMEOUT_MS` se configura muy bajo. */
const MIN_LOCK_TTL_MS = 120_000;

/**
 * Worker que ejecuta un turno del agente. Abre el `TenantContext` con el
 * `companyId` del job para aislar todas las operaciones.
 *
 * Antes de correr aplica dos guardas sobre el mismo lead:
 *  1. **Agrupación**: si llegó un mensaje más nuevo, este turno se omite — el
 *     job de ese mensaje contestará a todo junto.
 *  2. **Candado**: nunca dos turnos del mismo lead a la vez. Si está ocupado,
 *     el job se reprograma en vez de responder en paralelo.
 */
@Processor(QUEUE_AGENT_TURN, { concurrency: 4 })
export class AgentTurnProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentTurnProcessor.name);
  /** El candado debe sobrevivir al turno más lento que la config permita. */
  private readonly lockTtlMs: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly runner: AgentRunner,
    private readonly prisma: PrismaService,
    private readonly lock: TurnLockService,
    @InjectQueue(QUEUE_AGENT_TURN)
    private readonly queue: Queue<AgentTurnJobData>,
  ) {
    super();
    this.lockTtlMs = Math.max(
      2 * config.get('AGENT_TIMEOUT_MS', { infer: true }),
      MIN_LOCK_TTL_MS,
    );
  }

  async process(job: Job<AgentTurnJobData>): Promise<void> {
    const { companyId, leadId, correlationId } = job.data;
    await TenantContext.run(
      { companyId, correlationId: correlationId || randomUUID() },
      async () => {
        if (await this.supersedido(job.data)) {
          this.logger.log(
            `Turno omitido: llegó un mensaje más nuevo (leadId=${leadId})`,
          );
          return;
        }

        const token = await this.lock.acquire(leadId, this.lockTtlMs);
        if (!token) {
          await this.reprogramar(job.data);
          return;
        }

        try {
          await this.runner.runTurn(leadId);
        } catch (error) {
          this.logger.error(
            `Fallo en turno del agente (leadId=${leadId}): ${(error as Error).message}`,
          );
          throw error;
        } finally {
          await this.lock.release(leadId, token);
        }
      },
    );
  }

  /**
   * true si ya hay un mensaje del cliente posterior al que originó este turno.
   * Se evalúa de nuevo en cada reintento, así una ráfaga larga sigue colapsando
   * en un solo turno: el que responde es siempre el del último mensaje.
   */
  private async supersedido(data: AgentTurnJobData): Promise<boolean> {
    if (data.inboundAt === undefined) {
      return false;
    }
    const ultimo = await this.prisma.db.interaction.findFirst({
      where: {
        leadId: data.leadId,
        channel: { in: CONVERSATION_CHANNELS },
        direction: Direction.inbound,
      },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    return !!ultimo && ultimo.occurredAt.getTime() > data.inboundAt;
  }

  /** Reencola el turno tras `LOCK_RETRY_MS`, con tope de reintentos. */
  private async reprogramar(data: AgentTurnJobData): Promise<void> {
    const retries = (data.retries ?? 0) + 1;
    if (retries > MAX_LOCK_RETRIES) {
      this.logger.warn(
        `Lead ${data.leadId} con un turno en curso tras ${MAX_LOCK_RETRIES} ` +
          'reintentos: este turno se descarta',
      );
      return;
    }
    await this.queue.add(
      'turn',
      { ...data, retries },
      { delay: LOCK_RETRY_MS },
    );
  }
}
