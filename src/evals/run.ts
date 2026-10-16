import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { EnvVars } from '../common/config/env.validation';
import { AnthropicService } from '../llm/anthropic.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { CASOS } from './cases';
import { checksDeterministas, juzgar } from './judge';
import {
  EvalCase,
  EvalResult,
  PIEZAS_MEMORIA,
  PiezaMemoria,
  RunOptions,
} from './types';
import { runCase } from './world';

/**
 * Corre el banco de evaluaciones contra el modelo real y reporta.
 *
 * `npm run eval` — todos los casos.
 * `npm run eval -- precio` — solo los casos cuyo id contenga "precio".
 * `npm run eval -- --sin=hechos` — con esa pieza de la memoria apagada.
 * `npm run eval -- --ablacion memoria-larga` — corre los casos con todo, sin
 *   cada pieza y sin memoria, y compara (el experimento de *Generative
 *   Agents*). Cuesta una corrida del banco por condición.
 *
 * Necesita `ANTHROPIC_API_KEY`. Cada caso son unas pocas llamadas al modelo
 * más una del juez: correr el banco entero cuesta centavos, no dólares.
 */

const VERDE = '[32m';
const ROJO = '[31m';
const GRIS = '[90m';
const RESET = '[0m';

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
  // Las evaluaciones corren sin base de datos ni Redis: no se registra la
  // salud del proveedor (alertas), solo se ejecuta la llamada.
  const sinAlertas = {
    observe: <T>(_target: unknown, send: () => Promise<T>) => send(),
  } as unknown as ProviderHealthService;
  return new AnthropicService(config, sinAlertas);
}

export interface Args {
  filtro?: string;
  sin: PiezaMemoria[];
  ablacion: boolean;
}

/** Lee `[filtro] [--sin=pieza,pieza] [--ablacion]`, en cualquier orden. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { sin: [], ablacion: false };
  for (const arg of argv) {
    if (arg === '--ablacion') {
      args.ablacion = true;
    } else if (arg.startsWith('--sin=')) {
      for (const pieza of arg.slice('--sin='.length).split(',')) {
        if (!PIEZAS_MEMORIA.includes(pieza as PiezaMemoria)) {
          throw new Error(
            `Pieza desconocida "${pieza}". Se pueden apagar: ${PIEZAS_MEMORIA.join(', ')}.`,
          );
        }
        args.sin.push(pieza as PiezaMemoria);
      }
    } else {
      args.filtro = arg;
    }
  }
  if (args.ablacion && args.sin.length > 0) {
    throw new Error(
      'Usa --ablacion o --sin, no los dos: --ablacion ya apaga cada pieza.',
    );
  }
  return args;
}

/** Una forma de correr el banco: con todo, o con alguna pieza apagada. */
export interface Condicion {
  nombre: string;
  sin: PiezaMemoria[];
}

/**
 * Condiciones a correr. La ablación sigue al paper: con todo, sin cada pieza
 * por separado y sin ninguna, para ver cuánto aporta cada una.
 */
export function condicionesPara(args: Args): Condicion[] {
  if (args.ablacion) {
    return [
      { nombre: 'completo', sin: [] },
      ...PIEZAS_MEMORIA.map((p) => ({ nombre: `sin ${p}`, sin: [p] })),
      { nombre: 'sin memoria', sin: [...PIEZAS_MEMORIA] },
    ];
  }
  if (args.sin.length > 0) {
    return [{ nombre: `sin ${args.sin.join(' ni ')}`, sin: args.sin }];
  }
  return [{ nombre: 'completo', sin: [] }];
}

/** Corre un caso completo: turno + comprobaciones + juez. */
export async function evaluar(
  caso: EvalCase,
  anthropic: AnthropicService,
  opciones: RunOptions = {},
): Promise<EvalResult> {
  const run = await runCase(caso, anthropic, opciones);
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

  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const { filtro } = args;
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

  const condiciones = condicionesPara(args);
  const totales: Array<{ nombre: string; texto: string; todoOk: boolean }> = [];
  for (const condicion of condiciones) {
    console.log(`Evaluando ${casos.length} casos (${condicion.nombre})...\n`);
    const resultados: EvalResult[] = [];
    for (const caso of casos) {
      const result = await evaluar(caso, anthropic, { sin: condicion.sin });
      resultados.push(result);
      imprimir(result);
    }

    const ok = resultados.filter((r) => r.ok).length;
    const totalChecks = resultados.reduce((n, r) => n + r.checks.length, 0);
    const okChecks = resultados.reduce(
      (n, r) => n + r.checks.filter((c) => c.ok).length,
      0,
    );
    const texto =
      `${ok}/${resultados.length} casos completos · ` +
      `${okChecks}/${totalChecks} criterios`;
    console.log(`\n${texto}\n`);
    totales.push({
      nombre: condicion.nombre,
      texto,
      todoOk: ok === resultados.length,
    });
  }

  if (totales.length > 1) {
    console.log('Ablación:');
    for (const t of totales) {
      console.log(`  ${t.nombre.padEnd(14)} ${t.texto}`);
    }
  }
  // En una ablación se espera que las condiciones recortadas fallen: el
  // resultado del proceso lo decide la primera condición (con todo).
  process.exit(totales[0].todoOk ? 0 : 1);
}

if (require.main === module) {
  void main();
}
