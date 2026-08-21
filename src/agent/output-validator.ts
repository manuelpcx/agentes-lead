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
 * turno MÁS los datos de contacto del propio lead. El teléfono/email del lead no
 * son cifras "inventadas": el agente puede referirlos (incluso formateados, p.
 * ej. "+569 2033 7143"), así que se agregan como respaldo para evitar falsos
 * positivos con fragmentos del teléfono.
 */
export function leadFactSources(
  recordedFacts: string[],
  lead: { phone?: string | null; email?: string | null },
): string[] {
  const own: string[] = [];
  if (lead.phone) {
    own.push(lead.phone);
  }
  if (lead.email) {
    own.push(lead.email);
  }
  return [...recordedFacts, ...own];
}
