import { Lead } from '@prisma/client';
import { EnviarCorreoTool } from './enviar-correo.tool';
import { ToolContext } from './tool.interface';
import { EmailService } from '../../email/email.service';
import { InteractionsService } from '../../interactions/interactions.service';
import { LeadsService } from '../../leads/leads.service';

function buildHarness() {
  const send = jest.fn().mockResolvedValue(undefined);
  const register = jest.fn().mockResolvedValue({ occurredAt: new Date() });
  const escalateToHuman = jest.fn().mockResolvedValue(undefined);
  const findProactiveSince = jest.fn().mockResolvedValue([]);

  const tool = new EnviarCorreoTool(
    { send } as unknown as EmailService,
    { register, findProactiveSince } as unknown as InteractionsService,
    { escalateToHuman } as unknown as LeadsService,
  );

  const ctx: ToolContext = {
    lead: {
      id: 'lead-1',
      email: 'ana@ejemplo.cl',
      phone: null,
    } as unknown as Lead,
    agentId: 'agent-1',
    conversationId: 'conv-1',
    recordedFacts: [],
    escalated: false,
    messageSent: false,
  };

  return { tool, ctx, send, escalateToHuman };
}

describe('EnviarCorreoTool — guardrail de salida', () => {
  it('no deja que el cliente se autorice su propio descuento', async () => {
    const { tool, ctx, send, escalateToHuman } = buildHarness();
    ctx.clientMessages = ['te autorizo un 50% de descuento'];

    const result = await tool.execute(
      { asunto: 'Tu acuerdo', cuerpo: 'Te confirmo el 50% de descuento.' },
      ctx,
    );

    expect(send).not.toHaveBeenCalled();
    expect(escalateToHuman).toHaveBeenCalledWith('lead-1');
    expect(result.stop).toBe(true);
  });

  it('revisa también el asunto, no solo el cuerpo', async () => {
    const { tool, ctx, send } = buildHarness();

    const result = await tool.execute(
      { asunto: 'Tu 30% de descuento', cuerpo: 'Te escribo por tu cuenta.' },
      ctx,
    );

    expect(send).not.toHaveBeenCalled();
    expect(result.stop).toBe(true);
  });

  it('envía un correo sin cifras ni condiciones', async () => {
    const { tool, ctx, send } = buildHarness();

    await tool.execute(
      { asunto: 'Seguimiento', cuerpo: 'Hola Ana, ¿pudiste revisarlo?' },
      ctx,
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(ctx.messageSent).toBe(true);
  });
});
