/** Resultado de validar un mensaje saliente contra los datos de herramientas. */
export interface OutputValidation {
  allowed: boolean;
  /** Cifras del mensaje que NO están respaldadas por un resultado de tool. */
  offending: string[];
}

/** Extrae solo los dígitos de un texto (para comparar cifras sin separadores). */
function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Valida un mensaje saliente: toda cifra "significativa" (secuencia de 4+
 * dígitos, típica de precios/montos en CLP) debe aparecer en el texto
 * concatenado de los resultados de herramientas de este turno. Si alguna no
 * está respaldada, el mensaje se bloquea y el agente escala.
 *
 * Heurística deliberadamente conservadora (mejor bloquear que filtrar un dato
 * inventado). Ajustable: el umbral de 4 dígitos evita falsos positivos con
 * horas o cantidades pequeñas.
 */
export function validateOutgoingMessage(
  message: string,
  factSources: string[],
): OutputValidation {
  const factsDigits = digitsOnly(factSources.join(' '));
  const numbers = message.match(/\d[\d.,]*\d|\d+/g) ?? [];

  const offending: string[] = [];
  for (const raw of numbers) {
    const seq = digitsOnly(raw);
    if (seq.length < 4) {
      continue; // ignora cifras pequeñas (horas, cantidades)
    }
    if (!factsDigits.includes(seq)) {
      offending.push(raw);
    }
  }

  return { allowed: offending.length === 0, offending };
}

/**
 * Fuentes de datos válidas para el guardrail: los resultados de herramientas del
 * turno MÁS los datos de contacto del propio lead MÁS su `metadata` MÁS datos
 * propios de la empresa (p. ej. su WhatsApp). Ninguno es una cifra "inventada":
 * el teléfono/email/metadata vienen de la ingesta confiable (formulario, ERP,
 * n8n), no del modelo. El guardrail existe para impedir que el LLM invente
 * cifras, no para bloquear datos reales del upstream — por eso la metadata (que
 * en cobranza trae monto/vencimiento/folio) cuenta como respaldo.
 *
 * `extra` permite pasar datos adicionales de respaldo (nulos/vacíos se ignoran).
 */
export function leadFactSources(
  recordedFacts: string[],
  lead: { phone?: string | null; email?: string | null; metadata?: unknown },
  extra: Array<string | null | undefined> = [],
): string[] {
  const own: string[] = [];
  if (lead.phone) {
    own.push(lead.phone);
  }
  if (lead.email) {
    own.push(lead.email);
  }
  if (lead.metadata && typeof lead.metadata === 'object') {
    own.push(JSON.stringify(lead.metadata));
  }
  for (const value of extra) {
    if (value) {
      own.push(value);
    }
  }
  return [...recordedFacts, ...own];
}
