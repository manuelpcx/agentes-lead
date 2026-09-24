import { CancelarSeguimientoTool } from './cancelar-seguimiento.tool';
import { LeadsService } from '../../leads/leads.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { ToolContext } from './tool.interface';

function build() {
  const leads = {
    cancelNextAction: jest.fn().mockResolvedValue({}),
  } as unknown as LeadsService;
  const interactions = {
    register: jest.fn().mockResolvedValue({}),
  } as unknown as InteractionsService;
  return {
    tool: new CancelarSeguimientoTool(leads, interactions),
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

describe('CancelarSeguimientoTool', () => {
  it('limpia la próxima acción del lead y deja constancia en el historial', async () => {
    const { tool, leads, interactions } = build();
    const ctx = ctxBase();

    const res = await tool.execute(
      { motivo: 'Cliente pidió no ser llamado' },
      ctx,
    );

    expect(leads.cancelNextAction).toHaveBeenCalledWith('lead-1');
    expect(interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        content: expect.stringContaining('Cliente pidió no ser llamado'),
      }),
    );
    expect(res.content).toMatch(/no vuelvas a ofrecer/i);
  });

  it('usa un motivo por defecto si no viene ninguno', async () => {
    const { tool, interactions } = build();
    await tool.execute({}, ctxBase());
    expect(interactions.register).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Solicitud del cliente'),
      }),
    );
  });
});
