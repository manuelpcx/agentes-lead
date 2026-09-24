import { AgentType, Direction } from '@prisma/client';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnthropicService } from '../llm/anthropic.service';
import { PromptService } from '../prompts/prompt.service';
import { KnowledgeGapsService } from './knowledge-gaps.service';
import { ExampleLibraryService } from './example-library.service';
import { ComplianceIssuesService } from './compliance-issues.service';

function buildHarness(llmResponse: string) {
  const prisma = {
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conv-1',
          agentId: 'agent-1',
          leadId: 'lead-1',
          startedAt: new Date('2026-09-01T00:00:00Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      agent: {
        findFirst: jest.fn().mockResolvedValue({ type: AgentType.COBRANZA }),
      },
      interaction: {
        findMany: jest.fn().mockResolvedValue([
          { direction: Direction.inbound, content: 'no me llames' },
          { direction: Direction.outbound, content: 'te llamo en 1 hora' },
        ]),
      },
    },
  } as unknown as PrismaService;
  const anthropic = {
    isConfigured: jest.fn().mockReturnValue(true),
    complete: jest.fn().mockResolvedValue(llmResponse),
  } as unknown as AnthropicService;
  const prompts = {
    getActiveContent: jest
      .fn()
      .mockResolvedValue('REGLAS: no llames si te lo piden.'),
  } as unknown as PromptService;
  const gaps = { recordGap: jest.fn() } as unknown as KnowledgeGapsService;
  const examples = { record: jest.fn() } as unknown as ExampleLibraryService;
  const compliance = {
    recordIssue: jest.fn(),
  } as unknown as ComplianceIssuesService;
  const service = new AnalysisService(
    prisma,
    anthropic,
    prompts,
    gaps,
    examples,
    compliance,
  );
  return { service, prisma, anthropic, prompts, gaps, examples, compliance };
}

describe('AnalysisService.analyzeConversation', () => {
  it('usa las reglas activas del agente de ESA conversación (no un prompt genérico)', async () => {
    const { service, prisma, prompts, anthropic } = buildHarness(
      JSON.stringify({ gaps: [], complianceIssues: [], positiveExample: null }),
    );

    await service.analyzeConversation('conv-1');

    expect(prisma.db.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-1' } }),
    );
    expect(prompts.getActiveContent).toHaveBeenCalledWith(
      'agent-1',
      AgentType.COBRANZA,
    );
    const [, userMessage] = (anthropic.complete as jest.Mock).mock.calls[0];
    expect(userMessage).toContain('REGLAS DEL AGENTE');
    expect(userMessage).toContain('REGLAS: no llames si te lo piden.');
    expect(userMessage).toContain('no me llames');
  });

  it('registra las fallas de cumplimiento detectadas para el agente correcto', async () => {
    const { service, compliance } = buildHarness(
      JSON.stringify({
        gaps: [],
        complianceIssues: [
          {
            issue: 'Siguió ofreciendo llamar después de un "no me llames"',
            evidence: 'te llamo en 1 hora',
          },
        ],
        positiveExample: null,
      }),
    );

    await service.analyzeConversation('conv-1');

    expect(compliance.recordIssue).toHaveBeenCalledWith(
      'agent-1',
      'Siguió ofreciendo llamar después de un "no me llames"',
      'te llamo en 1 hora',
      'conv-1',
    );
  });

  it('sigue registrando vacíos y ejemplos como antes', async () => {
    const { service, gaps, examples } = buildHarness(
      JSON.stringify({
        gaps: [{ question: '¿tienen convenio?', suggestedAnswer: null }],
        complianceIssues: [],
        positiveExample: {
          situation: 'cliente dudaba',
          agentResponse: 'le expliqué el link de pago',
          outcome: 'prometió pagar',
        },
      }),
    );

    await service.analyzeConversation('conv-1');

    expect(gaps.recordGap).toHaveBeenCalledWith(
      '¿tienen convenio?',
      undefined,
      'conv-1',
    );
    expect(examples.record).toHaveBeenCalledWith(
      'cliente dudaba',
      'le expliqué el link de pago',
      'prometió pagar',
    );
  });

  it('marca la conversación como analizada aunque el LLM falle', async () => {
    const { service, prisma, anthropic } = buildHarness('');
    (anthropic.complete as jest.Mock).mockRejectedValue(new Error('boom'));

    await service.analyzeConversation('conv-1');

    expect(prisma.db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { analyzedAt: expect.any(Date) },
    });
  });
});
