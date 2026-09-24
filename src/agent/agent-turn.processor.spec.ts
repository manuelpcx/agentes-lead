import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import {
  AgentTurnProcessor,
  LOCK_RETRY_MS,
  MAX_LOCK_RETRIES,
} from './agent-turn.processor';
import { AgentTurnJobData } from './agent-turn.job';
import { AgentRunner } from './agent-runner.service';
import { TurnLockService } from './turn-lock.service';
import { PrismaService } from '../common/prisma/prisma.service';
import type { EnvVars } from '../common/config/env.validation';

/** Última interacción entrante que devuelve el Prisma simulado (o null). */
function buildHarness(options: { ultimoEntranteMs?: number; libre?: boolean }) {
  const config = {
    get: (key: string) => (key === 'AGENT_TIMEOUT_MS' ? 60000 : undefined),
  } as unknown as ConfigService<EnvVars, true>;

  const runTurn = jest.fn().mockResolvedValue(undefined);
  const runner = { runTurn } as unknown as AgentRunner;

  const prisma = {
    db: {
      interaction: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.ultimoEntranteMs
              ? { occurredAt: new Date(options.ultimoEntranteMs) }
              : null,
          ),
      },
    },
  } as unknown as PrismaService;

  const acquire = jest
    .fn()
    .mockResolvedValue(options.libre === false ? null : 'token-1');
  const release = jest.fn().mockResolvedValue(undefined);
  const lock = { acquire, release } as unknown as TurnLockService;

  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { add } as unknown as Queue<AgentTurnJobData>;

  const processor = new AgentTurnProcessor(config, runner, prisma, lock, queue);
  return { processor, runTurn, acquire, release, add };
}

function job(data: Partial<AgentTurnJobData>): Job<AgentTurnJobData> {
  return {
    data: {
      companyId: 'company-1',
      leadId: 'lead-1',
      correlationId: 'corr-1',
      ...data,
    },
  } as Job<AgentTurnJobData>;
}

describe('AgentTurnProcessor', () => {
  it('corre el turno y libera el candado', async () => {
    const { processor, runTurn, release } = buildHarness({});

    await processor.process(job({}));

    expect(runTurn).toHaveBeenCalledWith('lead-1');
    expect(release).toHaveBeenCalledWith('lead-1', 'token-1');
  });

  it('omite el turno si llegó un mensaje más nuevo (ráfaga del cliente)', async () => {
    const { processor, runTurn, acquire } = buildHarness({
      ultimoEntranteMs: 2_000,
    });

    await processor.process(job({ inboundAt: 1_000 }));

    expect(runTurn).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('corre si el mensaje que lo originó sigue siendo el último', async () => {
    const { processor, runTurn } = buildHarness({ ultimoEntranteMs: 1_000 });

    await processor.process(job({ inboundAt: 1_000 }));

    expect(runTurn).toHaveBeenCalledWith('lead-1');
  });

  it('un turno sin "inboundAt" (derivación) nunca se omite', async () => {
    const { processor, runTurn } = buildHarness({ ultimoEntranteMs: 9_999 });

    await processor.process(job({}));

    expect(runTurn).toHaveBeenCalledWith('lead-1');
  });

  it('reprograma en vez de correr en paralelo si el lead está ocupado', async () => {
    const { processor, runTurn, add } = buildHarness({ libre: false });

    await processor.process(job({}));

    expect(runTurn).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'turn',
      expect.objectContaining({ leadId: 'lead-1', retries: 1 }),
      { delay: LOCK_RETRY_MS },
    );
  });

  it('deja de reprogramar tras el tope de reintentos', async () => {
    const { processor, add } = buildHarness({ libre: false });

    await processor.process(job({ retries: MAX_LOCK_RETRIES }));

    expect(add).not.toHaveBeenCalled();
  });

  it('libera el candado aunque el turno falle', async () => {
    const { processor, runTurn, release } = buildHarness({});
    (runTurn as jest.Mock).mockRejectedValue(new Error('boom'));

    await expect(processor.process(job({}))).rejects.toThrow('boom');
    expect(release).toHaveBeenCalledWith('lead-1', 'token-1');
  });
});
