/**
 * Extracción automática de hechos: en el trabajo de fondo, un modelo barato
 * relee la conversación y anota lo duradero, sin depender de que el agente se
 * acuerde de llamar a `guardarEnMemoria` en medio de un turno.
 */
import {
  MAX_VALOR_CHARS,
  MemoryFact,
  normalizeImportance,
  normalizeKey,
  upsertFact,
} from './lead-memory';

/** Hechos que puede agregar una sola pasada: el resto espera a la próxima. */
export const MAX_EXTRAIDOS = 5;

/** Un hecho tal como lo propone el modelo. */
export interface HechoExtraido {
  clave: string;
  valor: string;
  importancia: number;
}

/** Extrae el primer objeto JSON del texto (tolera fences de markdown). */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Lee la respuesta del modelo. Devuelve `null` si no se pudo leer y `[]` si
 * el modelo dijo que no hay nada nuevo. Descarta lo que no traiga clave y
 * valor de texto, y se queda con los primeros `MAX_EXTRAIDOS`.
 */
export function parseFactsResponse(raw: string): HechoExtraido[] | null {
  const parsed = extractJson(raw) as { hechos?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.hechos)) {
    return null;
  }
  const out: HechoExtraido[] = [];
  for (const item of parsed.hechos) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { clave, valor, importancia } = item as Record<string, unknown>;
    if (typeof clave !== 'string' || typeof valor !== 'string') {
      continue;
    }
    if (!normalizeKey(clave) || !valor.trim()) {
      continue;
    }
    out.push({ clave, valor, importancia: normalizeImportance(importancia) });
  }
  return out.slice(0, MAX_EXTRAIDOS);
}

function mismoValor(a: string, b: string): boolean {
  const limpio = (s: string) =>
    s.replace(/\s+/g, ' ').trim().slice(0, MAX_VALOR_CHARS).toLowerCase();
  return limpio(a) === limpio(b);
}

/**
 * Mezcla lo extraído con lo que ya había. Un hecho que no cambió se deja como
 * estaba (sin renovar su fecha), y uno que se actualiza nunca baja de
 * importancia: la extracción automática no puede degradar lo que anotó el
 * agente o una persona desde el panel.
 */
export function mergeExtractedFacts(
  actuales: MemoryFact[],
  extraidos: HechoExtraido[],
  now = new Date(),
): MemoryFact[] {
  let facts = actuales;
  for (const h of extraidos) {
    const previo = facts.find((f) => f.clave === normalizeKey(h.clave));
    if (previo && mismoValor(previo.valor, h.valor)) {
      continue;
    }
    const importancia = Math.max(previo?.importancia ?? 1, h.importancia);
    facts = upsertFact(facts, h.clave, h.valor, importancia, now);
  }
  return facts;
}
