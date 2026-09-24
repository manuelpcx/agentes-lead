import { NotFoundException } from '@nestjs/common';
import { ComplianceIssueStatus } from '@prisma/client';
import { ComplianceIssuesService } from './compliance-issues.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant/tenant-context';

function buildHarness() {
  const prisma = {
    db: {
      complianceIssue: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'ci-1' }),
        update: jest.fn().mockResolvedValue({ id: 'ci-1' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ci-1',
            issue: 'x',
            agent: { name: 'Agente que cobra' },
          },
        ]),
      },
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn() } as unknown as AuditService;
  return { service: new ComplianceIssuesService(prisma, audit), prisma, audit };
}

function run<T>(fn: () => Promise<T>) {
  return TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);
}

describe('ComplianceIssuesService', () => {
  it('crea una nueva falla si no había una pendiente igual para ese agente', async () => {
    const { service, prisma } = buildHarness();
    (prisma.db.complianceIssue.findFirst as jest.Mock).mockResolvedValue(null);

    await run(() =>
      service.recordIssue(
        'agent-1',
        'Ignoró un "no me llames"',
        'cita',
        'conv-1',
      ),
    );

    expect(prisma.db.complianceIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          companyId: 'c1',
          agentId: 'agent-1',
          conversationId: 'conv-1',
          issue: 'Ignoró un "no me llames"',
          evidence: 'cita',
        },
      }),
    );
  });

  it('incrementa la frecuencia si ya hay una pendiente igual para el mismo agente', async () => {
    const { service, prisma } = buildHarness();
    (prisma.db.complianceIssue.findFirst as jest.Mock).mockResolvedValue({
      id: 'ci-1',
      evidence: 'evidencia previa',
    });

    await run(() =>
      service.recordIssue(
        'agent-1',
        'Ignoró un "no me llames"',
        'nueva',
        'conv-2',
      ),
    );

    expect(prisma.db.complianceIssue.create).not.toHaveBeenCalled();
    expect(prisma.db.complianceIssue.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { frequency: { increment: 1 }, evidence: 'evidencia previa' },
    });
  });

  it('listPending aplana el nombre del agente', async () => {
    const { service } = buildHarness();
    const result = await service.listPending();
    expect(result).toEqual([
      { id: 'ci-1', issue: 'x', agentName: 'Agente que cobra' },
    ]);
  });

  it('approve marca APROBADO y audita', async () => {
    const { service, prisma, audit } = buildHarness();
    (prisma.db.complianceIssue.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'ci-1',
    });

    await service.approve('ci-1', 'user-1');

    expect(prisma.db.complianceIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplianceIssueStatus.APROBADO,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approve_compliance_issue' }),
    );
  });

  it('lanza si intenta aprobar/rechazar algo que no existe', async () => {
    const { service, prisma } = buildHarness();
    (prisma.db.complianceIssue.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.approve('nope', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.reject('nope', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
