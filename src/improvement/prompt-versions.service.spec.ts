import { NotFoundException } from '@nestjs/common';
import { AgentType } from '@prisma/client';
import { PromptVersionsService } from './prompt-versions.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { getDefaultPrompt } from '../prompts/default-prompts';

function buildHarness(agent: { id: string; type: AgentType } | null) {
  const created = { id: 'pv-new', version: 2 };
  const prisma = {
    db: {
      agent: { findFirst: jest.fn().mockResolvedValue(agent) },
      promptVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ version: 1 }) // dentro de createProposal
          .mockResolvedValueOnce(created), // dentro de activate
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue(created),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn(prisma.db),
      ),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn() } as unknown as AuditService;
  return { service: new PromptVersionsService(prisma, audit), prisma, audit };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

describe('PromptVersionsService.resetToDefault', () => {
  it('lanza si el agente no existe', async () => {
    const { service } = buildHarness(null);
    await expect(
      run(() => service.resetToDefault('agent-1', 'user-1')),
    ).rejects.toThrow(NotFoundException);
  });

  it('crea una propuesta con el prompt por defecto del tipo del agente y la activa', async () => {
    const { service, prisma, audit } = buildHarness({
      id: 'agent-1',
      type: AgentType.COBRANZA,
    });

    const result = await run(() => service.resetToDefault('agent-1', 'user-1'));

    expect(prisma.db.promptVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: 'agent-1',
          content: getDefaultPrompt(AgentType.COBRANZA),
          isActive: false,
        }),
      }),
    );
    expect(prisma.db.promptVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'activate_prompt_version' }),
    );
    expect(result).toEqual({ id: 'pv-new', version: 2 });
  });
});

describe('PromptVersionsService.saveEdit', () => {
  it('lanza si el agente no existe', async () => {
    const { service } = buildHarness(null);
    await expect(
      run(() => service.saveEdit('agent-1', 'texto nuevo', 'user-1')),
    ).rejects.toThrow(NotFoundException);
  });

  it('crea una versión con el texto editado y la activa de inmediato', async () => {
    const { service, prisma, audit } = buildHarness({
      id: 'agent-1',
      type: AgentType.COBRANZA,
    });

    const result = await run(() =>
      service.saveEdit('agent-1', 'Eres un agente editado a mano.', 'user-1'),
    );

    expect(prisma.db.promptVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: 'agent-1',
          content: 'Eres un agente editado a mano.',
          changeReason: 'Editado manualmente desde el panel',
          isActive: false,
        }),
      }),
    );
    expect(prisma.db.promptVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'activate_prompt_version' }),
    );
    expect(result).toEqual({ id: 'pv-new', version: 2 });
  });
});
