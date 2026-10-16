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

/** Secuencias numéricas de un texto, con separadores de miles incluidos. */
const NUMBER_RE = /\d[\d.,]*\d|\d+/g;

/**
 * Cifras de una fuente de respaldo, cada una por separado.
 *
 * Antes se concatenaban los dígitos de TODAS las fuentes en una sola cadena y
 * se buscaba dentro. Con pocas fuentes funcionaba, pero cada fuente nueva
 * agrandaba ese pajar y hacía más probable que una cifra inventada calzara por
 * casualidad con el cruce de dos datos distintos. Comparar contra cada cifra
 * por separado cierra esa puerta sin perder nada: un teléfono escrito como
 * "+569 2033 7143" sigue calzando con "56920337143", porque la comparación
 * dentro de una misma cifra sigue siendo por subcadena.
 */
function numberTokens(source: string): string[] {
  return (source.match(NUMBER_RE) ?? [])
    .map(digitsOnly)
    .filter((d) => d.length > 0);
}

/**
 * Condiciones comerciales que se escriben con números chicos: un "50 %" de
 * descuento o "6 cuotas" no llegan a los 4 dígitos, pero inventarlas es tan
 * grave como inventar un precio. Se reconocen por lo que las acompaña.
 */
const PERCENT_RE = /\d+(?:[.,]\d+)?\s*(?:%|por\s*ciento)/gi;
const CUOTAS_RE = /\d+\s*cuotas?\b/gi;

/** Montos de menos de 4 dígitos con su moneda: "$990", "2,5 UF", "US$ 49". */
const SMALL_AMOUNT_RE =
  /(?:US\$|\$)\s*\d[\d.,]*|\d[\d.,]*\s*(?:UF|USD|CLP|pesos|d[oó]lares)\b/gi;

/**
 * "100 %" casi siempre es una forma de hablar ("100 % online"), no una
 * condición: bloquearlo escalaría mensajes normales.
 */
const EXPRESSION_PERCENT = '100';

/**
 * Un número chico se compara COMPLETO contra cada cifra de las fuentes. Por
 * subcadena, "50" calzaría dentro de cualquier teléfono y el respaldo no
 * respaldaría nada.
 */
function backedExactly(seq: string, tokens: string[]): boolean {
  return tokens.some((token) => token === seq);
}

/**
 * Valida un mensaje saliente. Dos reglas:
 *
 *  - Toda cifra "significativa" (secuencia de 4+ dígitos, típica de precios
 *    y montos en CLP) debe estar en alguna fuente del turno.
 *  - Toda condición comercial con números chicos (porcentajes, número de
 *    cuotas, montos con moneda) debe estar en una fuente. Porcentajes y
 *    cuotas se respaldan solo con `conditionSources`: los ofrece la empresa,
 *    no el cliente.
 *
 * Si algo no tiene respaldo, el mensaje se bloquea y el agente escala.
 *
 * Heurística deliberadamente conservadora (mejor bloquear que filtrar un dato
 * inventado). Fuera de esas marcas, los números chicos se ignoran para no
 * bloquear horas ni cantidades sueltas.
 */
export function validateOutgoingMessage(
  message: string,
  factSources: string[],
  conditionSources: string[] = factSources,
): OutputValidation {
  const respaldo = factSources.flatMap(numberTokens);
  const respaldoCondiciones = conditionSources.flatMap(numberTokens);
  const numbers = message.match(NUMBER_RE) ?? [];

  const offending: string[] = [];
  for (const raw of numbers) {
    const seq = digitsOnly(raw);
    if (seq.length < 4) {
      continue; // los números chicos se revisan abajo, solo si son condiciones
    }
    if (!respaldo.some((token) => token.includes(seq))) {
      offending.push(raw);
    }
  }

  for (const raw of [
    ...(message.match(PERCENT_RE) ?? []),
    ...(message.match(CUOTAS_RE) ?? []),
  ]) {
    const seq = digitsOnly(raw);
    if (seq === EXPRESSION_PERCENT && raw.includes('%')) {
      continue;
    }
    if (!backedExactly(seq, respaldoCondiciones)) {
      offending.push(raw.trim());
    }
  }

  for (const raw of message.match(SMALL_AMOUNT_RE) ?? []) {
    const seq = digitsOnly(raw);
    if (seq.length >= 4) {
      continue; // ya la revisó la regla de las cifras largas
    }
    if (!backedExactly(seq, respaldo)) {
      offending.push(raw.trim());
    }
  }

  return { allowed: offending.length === 0, offending };
}

/** Lo que el validador necesita del turno para armar las fuentes de respaldo. */
export interface FactSourceContext {
  /** Resultados de las herramientas usadas en este turno. */
  recordedFacts: string[];
  lead: { phone?: string | null; email?: string | null; metadata?: unknown };
  /** Mensajes que escribió el CLIENTE en el historial visible. */
  clientMessages?: string[];
  companyWhatsApp?: string | null;
}

/**
 * Fuentes de datos válidas para el guardrail, en un solo lugar para que
 * ninguna herramienta de envío se quede con una lista distinta.
 *
 * Qué cuenta y por qué:
 *  - **Resultados de herramientas de este turno**: son datos de nuestros
 *    sistemas, no invención del modelo.
 *  - **Datos de contacto y `metadata` del lead**: vienen de la ingesta
 *    confiable (formulario, ERP, n8n). En cobranza la metadata trae monto,
 *    folio y vencimiento.
 *  - **Lo que escribió el cliente**: si la persona dio su RUT, su dirección o
 *    el número de su pedido, repetírselo es conversación normal, no una cifra
 *    inventada. Se toman SOLO sus mensajes, nunca los del agente: si no, una
 *    cifra alucinada hace tres semanas quedaría respaldada para siempre.
 *  - **El WhatsApp de la empresa**, para poder invitar a seguir por ahí.
 *
 * Lo que NO cuenta: la memoria del lead y las notas del equipo. Las escribe el
 * propio agente o son texto libre, así que una cifra de ahí tiene que volver a
 * comprobarse con una herramienta antes de decírsela al cliente.
 */
export function factSourcesFor(ctx: FactSourceContext): string[] {
  const sources = [...ctx.recordedFacts, ...(ctx.clientMessages ?? [])];
  if (ctx.lead.phone) {
    sources.push(ctx.lead.phone);
  }
  if (ctx.lead.email) {
    sources.push(ctx.lead.email);
  }
  if (ctx.lead.metadata && typeof ctx.lead.metadata === 'object') {
    sources.push(JSON.stringify(ctx.lead.metadata));
  }
  if (ctx.companyWhatsApp) {
    sources.push(ctx.companyWhatsApp);
  }
  return sources;
}

/**
 * Fuentes que pueden respaldar una condición comercial (un porcentaje, un
 * número de cuotas). Más estrictas que `factSourcesFor`: una condición solo la
 * puede dar la empresa, por sus herramientas del turno o por la metadata que
 * manda el ERP.
 *
 * Quedan fuera los mensajes del cliente (si no, "te autorizo un 50 %" le
 * daría respaldo al agente para aceptarlo) y los datos de contacto (el "92"
 * de un correo no es un descuento).
 */
export function conditionSourcesFor(ctx: FactSourceContext): string[] {
  const sources = [...ctx.recordedFacts];
  if (ctx.lead.metadata && typeof ctx.lead.metadata === 'object') {
    sources.push(JSON.stringify(ctx.lead.metadata));
  }
  return sources;
}

/**
 * Versión suelta de `factSourcesFor`, para llamadas que no tienen el contexto
 * completo del turno. `extra` admite datos adicionales de respaldo.
 */
export function leadFactSources(
  recordedFacts: string[],
  lead: { phone?: string | null; email?: string | null; metadata?: unknown },
  extra: Array<string | null | undefined> = [],
): string[] {
  return factSourcesFor({
    recordedFacts,
    lead,
    companyWhatsApp: null,
  }).concat(extra.filter((v): v is string => !!v));
}
