import { CalificarLeadTool } from './calificar-lead.tool';
import { LeadsService } from '../../leads/leads.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { ToolContext } from './tool.interface';

function build() {
  const leads = {
    setQualification: jest.fn().mockResolvedValue({}),
  } as unknown as LeadsService;
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  return {
    tool: new CalificarLeadTool(leads, interactions),
    leads,
    interactions,
  };
}

function ctxBase(): ToolContext {
  return {
    lead: { id: 'lead-1' },
    agentId: 'ag-1',
    recordedFacts: [],
    escalated: false,
    messageSent: false,
  } as unknown as ToolContext;
}

describe('CalificarLeadTool', () => {
  it('registra la calificación y avisa al lead service con el motivo', async () => {
    const { tool, leads, interactions } = build();

    const res = await tool.execute(
      { nivel: 'caliente', motivo: 'confirmó presupuesto y plazo' },
      ctxBase(),
    );

    expect(leads.setQualification).toHaveBeenCalledWith(
      'lead-1',
      'CALIENTE',
      'confirmó presupuesto y plazo',
    );
    expect(interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        content: expect.stringContaining('CALIENTE'),
      }),
    );
    expect(res.content).toContain('CALIENTE');
  });

  it('rechaza un nivel que no es FRIO/TIBIO/CALIENTE', async () => {
    const { tool, leads } = build();

    const res = await tool.execute(
      { nivel: 'MEDIO', motivo: 'algo' },
      ctxBase(),
    );

    expect(res.isError).toBe(true);
    expect(leads.setQualification).not.toHaveBeenCalled();
  });

  it('exige un motivo', async () => {
    const { tool, leads } = build();

    const res = await tool.execute({ nivel: 'TIBIO' }, ctxBase());

    expect(res.isError).toBe(true);
    expect(leads.setQualification).not.toHaveBeenCalled();
  });
});
