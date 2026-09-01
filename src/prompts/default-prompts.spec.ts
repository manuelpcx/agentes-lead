import { AgentType } from '@prisma/client';
import { getDefaultPrompt } from './default-prompts';

describe('getDefaultPrompt', () => {
  it('devuelve un prompt de ventas para VENTAS', () => {
    expect(getDefaultPrompt(AgentType.VENTAS)).toMatch(/ventas/i);
  });

  it('devuelve el prompt de cobranza para COBRANZA', () => {
    const p = getDefaultPrompt(AgentType.COBRANZA);
    expect(p).toMatch(/cobranza/i);
    expect(p).toMatch(/deuda/i);
    // Reglas de cumplimiento presentes.
    expect(p).toMatch(/registrarPromesaPago/);
    expect(p).toMatch(/PROHIBIDO|amenaz/i);
  });
});
