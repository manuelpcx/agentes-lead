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
    // No debe confundir el saldo/CRM en vivo con el monto de la deuda ya conocido.
    expect(p).toMatch(/consultarCrm/);
  });

  it('el prompt de cobranza trae las prohibiciones del art. 37 de la Ley 19.496', () => {
    const p = getDefaultPrompt(AgentType.COBRANZA);
    // Ni registros comerciales ni juicios que no se han iniciado.
    expect(p).toMatch(/DICOM/);
    expect(p).toMatch(/Boletín Comercial/);
    expect(p).toMatch(/juicios que no se han iniciado/);
    // Y la aclaración obligatoria sobre la naturaleza de la cobranza.
    expect(p).toMatch(
      /no es un procedimiento que persiga la ejecución de los bienes del deudor/,
    );
  });

  it('el prompt de cobranza no trae cifras que el guardrail bloquearía si el agente las repite', () => {
    // El system prompt no es fuente de respaldo: si el agente citara el número
    // de la ley ("19.496"), el mensaje se bloquearía y el lead iría a humano.
    expect(getDefaultPrompt(AgentType.COBRANZA)).not.toMatch(
      /\d{4,}|\d{1,3}\.\d{3}/,
    );
  });
});
