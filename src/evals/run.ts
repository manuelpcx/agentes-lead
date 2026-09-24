import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { EnvVars } from '../common/config/env.validation';
import { AnthropicService } from '../llm/anthropic.service';
import { CASOS } from './cases';
import { checksDeterministas, juzgar } from './judge';
import { EvalCase, EvalResult } from './types';
import { runCase } from './world';

/**
 * Corre el banco de evaluaciones contra el modelo real y reporta.
 *
 * `npm run eval` — todos los casos.
 * `npm run eval -- precio` — solo los casos cuyo id contenga "precio".
 *
 * Necesita `ANTHROPIC_API_KEY`. Cada caso son unas pocas llamadas al modelo
 * más una del juez: correr el banco entero cuesta centavos, no dólares.
 */

const VERDE = '[32m';
const ROJO = '[31m';
const GRIS = '[90m';
const RESET = '[0m';

function buildAnthropic(): AnthropicService {
  const env: Record<string, unknown> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    ANTHROPIC_EFFORT: process.env.ANTHROPIC_EFFORT ?? 'medium',
    ANTHROPIC_MAX_TOKENS: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096),
  };
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService<EnvVars, true>;
  return new AnthropicService(config);
}

/** Corre un caso completo: turno + comprobaciones + juez. */
export async function evaluar(
  caso: EvalCase,
  anthropic: AnthropicService,
): Promise<EvalResult> {
  const run = await runCase(caso, anthropic);
  const checks = [
    ...checksDeterministas(caso, run),
    ...(await juzgar(caso, run, anthropic)),
  ];
  return { caso, run, checks, ok: checks.every((c) => c.ok) };
}

function imprimir(result: EvalResult): void {
  const fallos = result.checks.filter((c) => !c.ok);
  const marca = result.ok ? `${VERDE}OK  ${RESET}` : `${ROJO}FALLA${RESET}`;
  console.log(
    `${marca} ${result.caso.id} ${GRIS}— ${result.caso.descripcion}${RESET}`,
  );
  for (const fallo of fallos) {
    console.log(`      ${ROJO}✗${RESET} ${fallo.criterio}`);
    if (fallo.detalle) {
      console.log(`        ${GRIS}${fallo.detalle}${RESET}`);
    }
  }
  if (!result.ok) {
    const enviado =
      result.run.mensajes.map((m) => m.texto).join(' | ') || '(nada)';
    console.log(`        ${GRIS}envió: ${enviado.slice(0, 200)}${RESET}`);
  }
}

async function main(): Promise<void> {
  // El banco imprime su propio reporte; los logs de Nest solo estorban.
  Logger.overrideLogger(false);

  const filtro = process.argv[2];
  const casos = filtro ? CASOS.filter((c) => c.id.includes(filtro)) : CASOS;

  if (casos.length === 0) {
    console.error(`Ningún caso coincide con "${filtro}".`);
    process.exit(1);
  }

  const anthropic = buildAnthropic();
  if (!anthropic.isConfigured()) {
    console.error(
      'Falta ANTHROPIC_API_KEY: el banco evalúa al modelo de verdad.',
    );
    process.exit(1);
  }

  console.log(`Evaluando ${casos.length} casos...\n`);
  const resultados: EvalResult[] = [];
  for (const caso of casos) {
    const result = await evaluar(caso, anthropic);
    resultados.push(result);
    imprimir(result);
  }

  const ok = resultados.filter((r) => r.ok).length;
  const totalChecks = resultados.reduce((n, r) => n + r.checks.length, 0);
  const okChecks = resultados.reduce(
    (n, r) => n + r.checks.filter((c) => c.ok).length,
    0,
  );
  console.log(
    `\n${ok}/${resultados.length} casos completos · ` +
      `${okChecks}/${totalChecks} criterios`,
  );
  process.exit(ok === resultados.length ? 0 : 1);
}

if (require.main === module) {
  void main();
}
