import { AnthropicService } from '../llm/anthropic.service';
import { EvalCase, EvalCheck, EvalRun } from './types';

/**
 * Juez: evalúa los criterios en lenguaje natural sobre lo que el agente le
 * mandó al cliente. Va aparte del turno, con su propia llamada, para que lo
 * que se juzga sea el resultado y no el razonamiento intermedio.
 */
const JUDGE_SYSTEM = `Eres un evaluador estricto de un agente conversacional de ventas y cobranza por WhatsApp. Recibes la conversación, lo que el agente respondió, y una lista de CRITERIOS. Dices, para cada criterio, si se cumple.

REGLAS:
- Evalúa SOLO el criterio, uno por uno, en el orden dado. No agregues criterios propios.
- Sé estricto pero justo: si el criterio se cumple en esencia aunque las palabras sean otras, es "cumple".
- Si el agente no le envió nada al cliente, casi ningún criterio sobre el mensaje se cumple.
- El motivo debe citar lo que viste, en una frase.

Responde SOLO con JSON válido, sin markdown:
{"resultados": [{"cumple": true, "motivo": "..."}]}
Un elemento por criterio, en el mismo orden.`;

interface JudgeResponse {
  resultados?: Array<{ cumple?: boolean; motivo?: string }>;
}

/** Extrae el primer objeto JSON del texto (tolera fences de markdown). */
function parseJson(text: string): JudgeResponse | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as JudgeResponse;
  } catch {
    return null;
  }
}

/** Transcribe el caso y la respuesta del agente para el juez. */
function renderParaJuez(caso: EvalCase, run: EvalRun): string {
  const conversacion = caso.historial
    .map((t) => {
      const quien =
        t.de === 'cliente'
          ? 'Cliente'
          : t.de === 'operador'
            ? 'Operador humano'
            : 'Agente';
      return `${quien}: ${t.texto}`;
    })
    .join('\n');

  const respuesta =
    run.mensajes.length > 0
      ? run.mensajes.map((m) => `(${m.canal}) ${m.texto}`).join('\n')
      : '(el agente no le envió NADA al cliente)';

  const usadas =
    run.acciones.length > 0
      ? run.acciones.map((a) => a.tool).join(', ')
      : '(ninguna)';

  return (
    `CONVERSACIÓN HASTA AHORA:\n${conversacion}\n\n` +
    `LO QUE EL AGENTE LE ENVIÓ AL CLIENTE:\n${respuesta}\n\n` +
    `HERRAMIENTAS QUE USÓ: ${usadas}\n\n` +
    `CRITERIOS:\n${caso.espera.criterios
      .map((c, i) => `${i + 1}. ${c}`)
      .join('\n')}`
  );
}

/**
 * Comprobaciones deterministas: qué herramientas usó y si escaló. No cuestan
 * tokens y son las que más rápido detectan una regresión de comportamiento.
 */
export function checksDeterministas(caso: EvalCase, run: EvalRun): EvalCheck[] {
  const checks: EvalCheck[] = [];
  const usadas = new Set(run.acciones.map((a) => a.tool));

  if (run.error) {
    checks.push({
      criterio: 'el turno termina sin error',
      ok: false,
      detalle: run.error,
    });
  }

  for (const tool of caso.espera.usa ?? []) {
    checks.push({
      criterio: `usa ${tool}`,
      ok: usadas.has(tool),
      detalle: usadas.has(tool) ? undefined : `usó: ${[...usadas].join(', ')}`,
    });
  }
  for (const tool of caso.espera.noUsa ?? []) {
    checks.push({ criterio: `no usa ${tool}`, ok: !usadas.has(tool) });
  }
  if (caso.espera.escala !== undefined) {
    checks.push({
      criterio: caso.espera.escala ? 'escala a humano' : 'no escala a humano',
      ok: run.escalado === caso.espera.escala,
    });
  }
  return checks;
}

/** Evalúa los criterios en lenguaje natural con el modelo. */
export async function juzgar(
  caso: EvalCase,
  run: EvalRun,
  anthropic: AnthropicService,
): Promise<EvalCheck[]> {
  if (caso.espera.criterios.length === 0) {
    return [];
  }
  let raw: string;
  try {
    raw = await anthropic.complete(JUDGE_SYSTEM, renderParaJuez(caso, run));
  } catch (error) {
    return caso.espera.criterios.map((criterio) => ({
      criterio,
      ok: false,
      detalle: `el juez falló: ${(error as Error).message}`,
    }));
  }

  const parsed = parseJson(raw);
  if (!parsed?.resultados) {
    return caso.espera.criterios.map((criterio) => ({
      criterio,
      ok: false,
      detalle: 'el juez no devolvió JSON legible',
    }));
  }

  return caso.espera.criterios.map((criterio, i) => {
    const r = parsed.resultados?.[i];
    return {
      criterio,
      ok: r?.cumple === true,
      detalle: r?.motivo,
    };
  });
}
