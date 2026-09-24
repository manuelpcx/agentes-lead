/**
 * Lógica pura de la memoria del lead: normalizar claves, mezclar hechos y
 * renderizarlos para el prompt. Sin base de datos, para poder probarla sola.
 */

/** Un hecho que el agente aprendió de la conversación. */
export interface MemoryFact {
  clave: string;
  valor: string;
  /** ISO del momento en que se guardó (o se actualizó). */
  registradoEn: string;
}

/** Tope de hechos por lead: al pasarlo se descartan los más antiguos. */
export const MAX_FACTS = 20;
export const MAX_CLAVE_CHARS = 40;
export const MAX_VALOR_CHARS = 200;
export const MAX_SUMMARY_CHARS = 800;

/**
 * Normaliza una clave a `snake_case` sin tildes. Sin esto, "Presupuesto",
 * "presupuesto " y "presupuesto" quedarían como tres hechos distintos y el
 * prompt terminaría contradiciéndose solo.
 */
export function normalizeKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_CLAVE_CHARS);
}

/** Recorta y limpia un texto de una línea. */
function clean(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Lee el JSON guardado como lista de hechos, descartando lo que no calce. */
export function parseFacts(raw: unknown): MemoryFact[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MemoryFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { clave, valor, registradoEn } = item as Record<string, unknown>;
    if (typeof clave !== 'string' || typeof valor !== 'string') {
      continue;
    }
    const key = normalizeKey(clave);
    const value = clean(valor, MAX_VALOR_CHARS);
    if (!key || !value) {
      continue;
    }
    out.push({
      clave: key,
      valor: value,
      registradoEn:
        typeof registradoEn === 'string'
          ? registradoEn
          : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Agrega o reemplaza un hecho. La misma clave se sobrescribe (lo último que
 * dijo la persona manda) y se mueve al final; pasado el tope, se van los más
 * antiguos.
 */
export function upsertFact(
  facts: MemoryFact[],
  clave: string,
  valor: string,
  now = new Date(),
): MemoryFact[] {
  const key = normalizeKey(clave);
  const value = clean(valor, MAX_VALOR_CHARS);
  if (!key || !value) {
    return facts;
  }
  const resto = facts.filter((f) => f.clave !== key);
  resto.push({ clave: key, valor: value, registradoEn: now.toISOString() });
  return resto.slice(-MAX_FACTS);
}

/** Quita un hecho por su clave. */
export function removeFact(facts: MemoryFact[], clave: string): MemoryFact[] {
  const key = normalizeKey(clave);
  return facts.filter((f) => f.clave !== key);
}

/**
 * Bloque de memoria para el system prompt. Va marcado como contexto y NO como
 * dato verificado: lo escribió el propio agente a partir de la conversación,
 * así que una cifra de aquí tiene que volver a comprobarse con una herramienta
 * antes de decírsela al cliente. Devuelve '' si no hay memoria.
 */
export function formatMemory(
  summary: string | null | undefined,
  facts: MemoryFact[],
): string {
  const partes: string[] = [];
  if (summary?.trim()) {
    partes.push(summary.trim());
  }
  if (facts.length > 0) {
    partes.push(facts.map((f) => `- ${f.clave}: ${f.valor}`).join('\n'));
  }
  if (partes.length === 0) {
    return '';
  }
  return (
    '\n\n--- Lo que ya sabes de esta persona ---\n' +
    'Memoria acumulada de conversaciones anteriores. Es contexto para ti, no ' +
    'un dato verificado: si necesitas una cifra o una condición comercial, ' +
    'consúltala con tus herramientas antes de afirmarla.\n' +
    `${partes.join('\n')}\n` +
    'Guarda aquí lo que valga la pena recordar con "guardarEnMemoria".'
  );
}
