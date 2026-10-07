import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { FollowUpScheduler } from './followup.scheduler';
import { PrismaService } from '../common/prisma/prisma.service';
import { FollowUpJobData } from './followup.job';
import type { EnvVars } from '../common/config/env.validation';

function buildHarness(
  due: { id: string; companyId: string; nextActionAt: Date }[][],
) {
  const config = {
    get: () => true,
  } as unknown as ConfigService<EnvVars, true>;
  const findMany = jest.fn();
  due.forEach((batch) => findMany.mockResolvedValueOnce(batch));
  const prisma = { raw: { lead: { findMany } } } as unknown as PrismaService;
  const add = jest.fn().mockResolvedValue({});
  const queue = { add } as unknown as Queue<FollowUpJobData>;
  return { scheduler: new FollowUpScheduler(config, prisma, queue), add };
}

const jobIds = (add: jest.Mock) =>
  add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId);

describe('FollowUpScheduler.sweep', () => {
  const t1 = new Date('2026-10-06T19:28:21.000Z');
  const t2 = new Date('2026-10-06T20:30:00.000Z');

  it('no duplica el job mientras la próxima acción sea la misma', async () => {
    const lead = { id: 'lead-1', companyId: 'c-1', nextActionAt: t1 };
    const h = buildHarness([[lead], [lead]]);
    await h.scheduler.sweep();
    await h.scheduler.sweep();
    const [a, b] = jobIds(h.add);
    expect(a).toBe(b);
    // BullMQ rechaza ids con ':'.
    expect(a).not.toContain(':');
  });

  it('un seguimiento reprogramado se encola con otro id, aunque el anterior haya fallado', async () => {
    // El job fallido se conserva en Redis con su id: si el id fuera solo el
    // del lead, el nuevo `add` se ignoraría y el lead quedaría trabado.
    const h = buildHarness([
      [{ id: 'lead-1', companyId: 'c-1', nextActionAt: t1 }],
      [{ id: 'lead-1', companyId: 'c-1', nextActionAt: t2 }],
    ]);
    await h.scheduler.sweep();
    await h.scheduler.sweep();
    const [a, b] = jobIds(h.add);
    expect(a).not.toBe(b);
  });
});
