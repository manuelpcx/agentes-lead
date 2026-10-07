import { Job } from 'bullmq';
import { FollowUpProcessor } from './followup.processor';
import { FollowUpService } from './followup.service';
import { FollowUpJobData } from './followup.job';

function buildHarness(error: Error) {
  const followup = {
    processFollowUp: jest.fn().mockRejectedValue(error),
    deferAfterFailure: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new FollowUpProcessor(
    followup as unknown as FollowUpService,
  );
  return { processor, followup };
}

function job(attemptsMade: number): Job<FollowUpJobData> {
  return {
    data: { companyId: 'c-1', leadId: 'lead-1', correlationId: 'corr-1' },
    attemptsMade,
    opts: { attempts: 5 },
  } as unknown as Job<FollowUpJobData>;
}

describe('FollowUpProcessor', () => {
  const error = new Error('Fallo al enviar WhatsApp (YCloud 403)');

  it('en un intento intermedio solo propaga el error (BullMQ reintenta)', async () => {
    const h = buildHarness(error);
    await expect(h.processor.process(job(1))).rejects.toThrow(error);
    expect(h.followup.deferAfterFailure).not.toHaveBeenCalled();
  });

  it('en el último intento posterga el seguimiento del lead', async () => {
    const h = buildHarness(error);
    // attemptsMade cuenta los fallos previos: el 5.º intento lleva 4.
    await expect(h.processor.process(job(4))).rejects.toThrow(error);
    expect(h.followup.deferAfterFailure).toHaveBeenCalledWith(
      'lead-1',
      error.message,
    );
  });

  it('si postergar también falla, se informa el error original', async () => {
    const h = buildHarness(error);
    h.followup.deferAfterFailure.mockRejectedValue(new Error('db caída'));
    await expect(h.processor.process(job(4))).rejects.toThrow(error);
  });
});
