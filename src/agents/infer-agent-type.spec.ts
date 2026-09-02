import { AgentType } from '@prisma/client';
import { inferAgentType } from './infer-agent-type';

describe('inferAgentType', () => {
  it('devuelve undefined sin metadata útil', () => {
    expect(inferAgentType(undefined)).toBeUndefined();
    expect(inferAgentType({})).toBeUndefined();
    expect(inferAgentType('x')).toBeUndefined();
    expect(inferAgentType({ nombre: 'Ana' })).toBeUndefined();
  });

  it('respeta la señal explícita (tipo/agentType) mapeada a AgentType', () => {
    expect(inferAgentType({ tipo: 'cobranza' })).toBe(AgentType.COBRANZA);
    expect(inferAgentType({ agentType: 'VENTAS' })).toBe(AgentType.VENTAS);
    expect(inferAgentType({ tipo: 'cobro' })).toBe(AgentType.COBRANZA);
  });

  it('infiere COBRANZA cuando la metadata parece una deuda', () => {
    expect(inferAgentType({ monto: 150000, folio: 'F-1' })).toBe(
      AgentType.COBRANZA,
    );
    expect(inferAgentType({ monto: 99000, vencimiento: '2026-08-15' })).toBe(
      AgentType.COBRANZA,
    );
  });

  it('no infiere COBRANZA con solo un monto (podría ser un presupuesto de venta)', () => {
    expect(inferAgentType({ monto: 150000 })).toBeUndefined();
  });
});
