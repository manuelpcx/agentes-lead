import { AgentType } from '@prisma/client';

const VALID = new Set<string>(Object.values(AgentType));

/**
 * Infiere qué TIPO de agente debería atender un lead a partir de su metadata,
 * para enrutar bien desde la creación (setups mixtos ventas + cobranza) sin
 * depender de la derivación.
 *
 * Prioridad:
 * 1. Señal explícita: `metadata.agentType` / `metadata.tipo` con un valor de
 *    AgentType (VENTAS, COBRANZA, ...). Es lo que debería mandar la ingesta/ERP.
 * 2. Heurística: si la metadata parece una deuda (monto + folio/vencimiento/
 *    dias_mora/link_pago) → COBRANZA.
 *
 * Devuelve el valor del enum o `undefined` si no puede inferirlo (el router cae
 * a su enrutamiento normal por canal/estado/default).
 */
export function inferAgentType(metadata: unknown): AgentType | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const m = metadata as Record<string, unknown>;

  // 1) Señal explícita.
  const explicit = m.agentType ?? m.tipo ?? m.tipoAgente;
  if (typeof explicit === 'string') {
    const up = explicit.trim().toUpperCase();
    if (VALID.has(up)) {
      return up as AgentType;
    }
    if (up === 'COBRO' || up === 'DEUDA') {
      return AgentType.COBRANZA;
    }
  }

  // 2) Heurística: parece una deuda.
  const has = (k: string) => m[k] !== undefined && m[k] !== null && m[k] !== '';
  if (
    has('monto') &&
    (has('folio') || has('vencimiento') || has('dias_mora') || has('link_pago'))
  ) {
    return AgentType.COBRANZA;
  }
  return undefined;
}
