/**
 * Reflexiones del lead (como en *Generative Agents*): conclusiones de alto
 * nivel que no están dichas en ningún mensaje, cada una con los mensajes que
 * la respaldan.
 *
 * La evidencia es lo que las hace confiables: el modelo cita mensajes por una
 * referencia corta (#n) y aquí se traduce a ids reales. Una conclusión que no
 * cita ningún mensaje que exista se descarta — es la misma idea que el
 * validador de cifras: lo que no tiene respaldo, no entra.
 */

/** Una conclusión sobre el lead y las interacciones que la respaldan. */
export interface Insight {
  texto: string;
  /** Ids de las interacciones que la respaldan. Nunca vacío. */
  evidencia: string[];
  /** ISO del momento en que se generó. */
  creadaEn: string;
}

export const MAX_INSIGHTS = 3;
export const MAX_INSIGHT_CHARS = 200;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_INSIGHT_CHARS);
}

/** "#3", "3" o " #3 " → "#3". */
function normalizeRef(raw: unknown): string | null {
  const m = /^#?\s*(\d+)$/.exec(String(raw ?? '').trim());
  return m ? `#${m[1]}` : null;
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
 * Lee la respuesta del modelo. `refs` traduce cada referencia que vio el
 * modelo (#n) al id de su interacción.
 *
 * Devuelve `null` si la respuesta no se pudo leer — y entonces se conservan
 * las conclusiones anteriores — y `[]` si el modelo dijo que no hay ninguna.
 */
export function parseInsightsResponse(
  raw: string,
  refs: Map<string, string>,
  now = new Date(),
): Insight[] | null {
  const parsed = extractJson(raw) as { conclusiones?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.conclusiones)) {
    return null;
  }

  const out: Insight[] = [];
  for (const item of parsed.conclusiones) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { texto, evidencia } = item as Record<string, unknown>;
    const text = typeof texto === 'string' ? clean(texto) : '';
    const ids = Array.isArray(evidencia)
      ? [
          ...new Set(
            evidencia
              .map(normalizeRef)
              .map((ref) => (ref ? refs.get(ref) : undefined))
              .filter((id): id is string => !!id),
          ),
        ]
      : [];
    if (!text || ids.length === 0) {
      continue;
    }
    out.push({ texto: text, evidencia: ids, creadaEn: now.toISOString() });
    if (out.length === MAX_INSIGHTS) {
      break;
    }
  }
  return out;
}

/** Lee el JSON guardado como lista de conclusiones, descartando lo que no calce. */
export function parseInsights(raw: unknown): Insight[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Insight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { texto, evidencia, creadaEn } = item as Record<string, unknown>;
    const ids = Array.isArray(evidencia)
      ? evidencia.filter((e): e is string => typeof e === 'string' && !!e)
      : [];
    if (typeof texto !== 'string' || !texto.trim() || ids.length === 0) {
      continue;
    }
    out.push({
      texto: clean(texto),
      evidencia: ids,
      creadaEn: typeof creadaEn === 'string' ? creadaEn : '',
    });
  }
  return out.slice(0, MAX_INSIGHTS);
}
