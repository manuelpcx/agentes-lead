/**
 * Lógica pura de la memoria del lead: normalizar claves, mezclar hechos y
 * renderizarlos para el prompt. Sin base de datos, para poder probarla sola.
 */
import type { Insight } from './insights';

/** Un hecho que el agente aprendió de la conversación. */
export interface MemoryFact {
  clave: string;
  valor: string;
  /**
   * 1 a 10, la pone quien guarda el hecho (como en *Generative Agents*). Decide
   * qué se descarta cuando la memoria se llena: un "no es el titular" no puede
   * perderse por veinte detalles anotados después.
   */
  importancia: number;
  /** ISO del momento en que se guardó (o se actualizó). */
  registradoEn: string;
}

/** La de un hecho sin importancia declarada (incluidos los guardados antes). */
export const DEFAULT_IMPORTANCE = 5;

/**
 * La de un hecho que agrega o corrige una persona desde el panel: lo hizo a
 * propósito, así que no debería desplazarlo lo que el agente anote después.
 */
export const OPERATOR_IMPORTANCE = 8;

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

/** Lleva cualquier valor a una importancia entera de 1 a 10. */
export function normalizeImportance(raw: unknown): number {
  // El modelo a veces manda el número como texto ("9").
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return DEFAULT_IMPORTANCE;
  }
  return Math.min(10, Math.max(1, Math.round(n)));
}

/**
 * Posición del hecho que conviene descartar: el de menor importancia y, entre
 * iguales, el más antiguo.
 */
function leastValuableIndex(facts: MemoryFact[]): number {
  let peor = 0;
  for (let i = 1; i < facts.length; i++) {
    const f = facts[i];
    const p = facts[peor];
    if (
      f.importancia < p.importancia ||
      (f.importancia === p.importancia && f.registradoEn < p.registradoEn)
    ) {
      peor = i;
    }
  }
  return peor;
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
    const { clave, valor, importancia, registradoEn } = item as Record<
      string,
      unknown
    >;
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
      importancia: normalizeImportance(importancia),
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
 * dijo la persona manda) y se mueve al final. Pasado el tope se descarta el
 * menos importante (y entre iguales, el más antiguo), que puede ser el mismo
 * hecho recién agregado si vale menos que todos los demás.
 */
export function upsertFact(
  facts: MemoryFact[],
  clave: string,
  valor: string,
  importancia = DEFAULT_IMPORTANCE,
  now = new Date(),
): MemoryFact[] {
  const key = normalizeKey(clave);
  const value = clean(valor, MAX_VALOR_CHARS);
  if (!key || !value) {
    return facts;
  }
  const lista = facts.filter((f) => f.clave !== key);
  lista.push({
    clave: key,
    valor: value,
    importancia: normalizeImportance(importancia),
    registradoEn: now.toISOString(),
  });
  while (lista.length > MAX_FACTS) {
    lista.splice(leastValuableIndex(lista), 1);
  }
  return lista;
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
  insights: Insight[] = [],
): string {
  const partes: string[] = [];
  if (summary?.trim()) {
    partes.push(summary.trim());
  }
  if (facts.length > 0) {
    partes.push(facts.map((f) => `- ${f.clave}: ${f.valor}`).join('\n'));
  }
  if (insights.length > 0) {
    // Son inferencias, no dichos: sirven para decidir CÓMO tratar a la
    // persona, no para afirmárselas como hechos.
    partes.push(
      'Conclusiones sobre esta persona (hipótesis deducidas de la ' +
        'conversación; úsalas para decidir cómo tratarla, no se las digas ' +
        'como hechos):\n' +
        insights
          .map(
            (i) =>
              `- ${i.texto} (según ${i.evidencia.length} ` +
              `${i.evidencia.length === 1 ? 'mensaje' : 'mensajes'})`,
          )
          .join('\n'),
    );
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
