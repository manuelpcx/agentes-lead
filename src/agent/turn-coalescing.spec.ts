import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { AgentTurnProcessor } from './agent-turn.processor';
import { AgentTurnJobData } from './agent-turn.job';
import { AgentRunner } from './agent-runner.service';
import { LockStore, TurnLockService } from './turn-lock.service';
import { WhatsappInboundService } from '../whatsapp/whatsapp-inbound.service';
import { InteractionsService } from '../interactions/interactions.service';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import type { EnvVars } from '../common/config/env.validation';

/**
 * Recorrido completo de una ráfaga: mensajes entrantes → cola (con la ventana
 * de agrupación) → worker. Sin Redis ni BullMQ reales, pero con las piezas de
 * verdad (`WhatsappInboundService`, `AgentTurnProcessor`, `TurnLockService`) y
 * un reloj controlado, que es donde vive la lógica que importa.
 *
 * Lo que fija: tres mensajes seguidos se contestan con UN turno, no con tres.
 */

const DEBOUNCE_MS = 8_000;

function buildWorld() {
  let ahora = 0;

  // ── Interacciones en memoria ──
  const entrantes: Array<{ occurredAt: Date }> = [];
  const interactions = {
    register: jest.fn(async () => {
      const row = { occurredAt: new Date(ahora) };
      entrantes.push(row);
      return row;
    }),
  } as unknown as InteractionsService;

  const prisma = {
    db: {
      interaction: {
        findFirst: jest.fn(async () => entrantes[entrantes.length - 1] ?? null),
      },
    },
  } as unknown as PrismaService;

  const leads = {
    findOrCreateByPhone: jest.fn().mockResolvedValue({ id: 'lead-1' }),
  } as unknown as LeadsService;

  // ── Cola simulada: respeta `delay` contra el reloj controlado ──
  const pendientes: Array<{ runAt: number; data: AgentTurnJobData }> = [];
  const queue = {
    add: jest.fn(
      async (
        _name: string,
        data: AgentTurnJobData,
        opts?: { delay?: number },
      ) => {
        pendientes.push({ runAt: ahora + (opts?.delay ?? 0), data });
      },
    ),
  } as unknown as Queue<AgentTurnJobData>;

  // ── Candado sobre un Redis de mentira ──
  const keys = new Map<string, string>();
  const store: LockStore = {
    set: async (key, value) => {
      if (keys.has(key)) {
        return null;
      }
      keys.set(key, value);
      return 'OK';
    },
    eval: async (_script, _n, key, token) => {
      if (keys.get(key) === token) {
        keys.delete(key);
      }
      return 1;
    },
  };

  const runTurn = jest.fn().mockResolvedValue(undefined);
  const config = {
    get: (key: string) =>
      key === 'AGENT_TIMEOUT_MS'
        ? 60_000
        : key === 'AGENT_TURN_DEBOUNCE_MS'
          ? DEBOUNCE_MS
          : undefined,
  } as unknown as ConfigService<EnvVars, true>;

  const processor = new AgentTurnProcessor(
    config,
    { runTurn } as unknown as AgentRunner,
    prisma,
    new TurnLockService(store),
    queue,
  );
  const inbound = new WhatsappInboundService(
    config,
    queue,
    leads,
    interactions,
  );

  const enTenant = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ companyId: 'company-1', correlationId: 'test' }, fn);

  return {
    runTurn,
    /** El cliente escribe en el instante `t`. */
    escribe: async (t: number, texto: string) => {
      ahora = t;
      await enTenant(() => inbound.handleIncoming('+56911111111', texto));
    },
    /** Corre los jobs vencidos, en orden, avanzando el reloj hasta cada uno. */
    correCola: async () => {
      for (;;) {
        pendientes.sort((a, b) => a.runAt - b.runAt);
        const job = pendientes.shift();
        if (!job) {
          return;
        }
        ahora = Math.max(ahora, job.runAt);
        await processor.process({ data: job.data } as Job<AgentTurnJobData>);
      }
    },
  };
}

describe('agrupación de mensajes entrantes', () => {
  it('contesta UNA vez a tres mensajes seguidos dentro de la ventana', async () => {
    const world = buildWorld();

    await world.escribe(0, 'hola');
    await world.escribe(2_000, 'quiero info');
    await world.escribe(5_000, 'del plan pro');
    await world.correCola();

    expect(world.runTurn).toHaveBeenCalledTimes(1);
  });

  it('contesta dos veces si el segundo mensaje llega mucho después', async () => {
    const world = buildWorld();

    await world.escribe(0, 'hola');
    await world.correCola();
    await world.escribe(600_000, '¿sigues ahí?');
    await world.correCola();

    expect(world.runTurn).toHaveBeenCalledTimes(2);
  });

  it('un mensaje suelto se contesta una sola vez', async () => {
    const world = buildWorld();

    await world.escribe(0, 'hola');
    await world.correCola();

    expect(world.runTurn).toHaveBeenCalledTimes(1);
  });
});
