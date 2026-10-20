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
 * `npm run eval -- --repeticiones=3 ...` — corre cada caso 3 veces y reporta
 *   cuántas pasó. El modelo no responde igual dos veces: para comparar
 *   condiciones, una sola corrida es puro ruido.
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
    // El de las tareas de fondo (extracción de hechos); sin él, el del turno.
    ANTHROPIC_BACKGROUND_MODEL: process.env.ANTHROPIC_BACKGROUND_MODEL,
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
  repeticiones: number;
}

const MAX_REPETICIONES = 10;

/**
 * Lee `[filtro] [--sin=pieza,pieza] [--ablacion] [--repeticiones=N]`, en
 * cualquier orden.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = { sin: [], ablacion: false, repeticiones: 1 };
  for (const arg of argv) {
    if (arg === '--ablacion') {
      args.ablacion = true;
    } else if (arg.startsWith('--repeticiones=')) {
      const valor = arg.slice('--repeticiones='.length);
      const n = Number(valor);
      // Tope de 10: cada repetición es una corrida pagada del banco.
      if (!/^\d+$/.test(valor) || n < 1 || n > MAX_REPETICIONES) {
        throw new Error(
          `--repeticiones debe ser un entero de 1 a ${MAX_REPETICIONES} (llegó "${valor}").`,
        );
      }
      args.repeticiones = n;
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

/** Un criterio sumado sobre las corridas en que apareció. */
export interface CriterioAgregado {
  criterio: string;
  ok: number;
  total: number;
  /** Motivo de la primera vez que falló. */
  detalle?: string;
}

/** Las N corridas de un mismo caso, resumidas. */
export interface Agregado {
  caso: EvalCase;
  corridas: number;
  completas: number;
  criterios: CriterioAgregado[];
  /** Lo que envió la primera corrida que falló, para depurar. */
  enviadoEnFallo?: string;
  /** Herramientas que usó esa misma corrida (con el motivo si escaló). */
  accionesEnFallo?: string;
  /** Lo que anotó la extracción de fondo en esa corrida, si corrió. */
  hechosEnFallo?: string;
}

/**
 * Suma las corridas de un caso. El modelo no responde igual dos veces: con
 * una sola corrida, un criterio que se cumple el 60 % del tiempo sale "OK" o
 * "FALLA" al azar. Contado sobre N corridas se ve como lo que es: 3/5.
 */
export function agregarCorridas(resultados: EvalResult[]): Agregado {
  const porCriterio = new Map<string, CriterioAgregado>();
  let enviadoEnFallo: string | undefined;
  let accionesEnFallo: string | undefined;
  let hechosEnFallo: string | undefined;

  for (const r of resultados) {
    for (const check of r.checks) {
      const actual = porCriterio.get(check.criterio) ?? {
        criterio: check.criterio,
        ok: 0,
        total: 0,
      };
      actual.total += 1;
      if (check.ok) {
        actual.ok += 1;
      } else if (actual.detalle === undefined && check.detalle) {
        actual.detalle = check.detalle;
      }
      porCriterio.set(check.criterio, actual);
    }
    if (!r.ok && enviadoEnFallo === undefined) {
      enviadoEnFallo =
        r.run.mensajes.map((m) => m.texto).join(' | ') || '(nada)';
      accionesEnFallo = resumirAcciones(r.run.acciones);
      if (r.run.hechosExtraidos !== undefined) {
        hechosEnFallo = r.run.hechosExtraidos.join(' | ') || '(ninguno)';
      }
    }
  }

  return {
    caso: resultados[0].caso,
    corridas: resultados.length,
    completas: resultados.filter((r) => r.ok).length,
    criterios: [...porCriterio.values()],
    ...(enviadoEnFallo !== undefined ? { enviadoEnFallo } : {}),
    ...(accionesEnFallo !== undefined ? { accionesEnFallo } : {}),
    ...(hechosEnFallo !== undefined ? { hechosEnFallo } : {}),
  };
}

/**
 * "consultarDato, escalarAHumano (motivo: …)": qué hizo el agente, con el
 * motivo cuando escaló, que es lo primero que hay que saber de un turno que
 * terminó sin responderle al cliente.
 */
function resumirAcciones(acciones: EvalResult['run']['acciones']): string {
  if (acciones.length === 0) {
    return '(ninguna)';
  }
  return acciones
    .map((a) =>
      typeof a.input.motivo === 'string'
        ? `${a.tool} (motivo: ${a.input.motivo})`
        : a.tool,
    )
    .join(', ');
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

function imprimir(agregado: Agregado): void {
  const todas = agregado.completas === agregado.corridas;
  const marca = todas ? `${VERDE}OK  ${RESET}` : `${ROJO}FALLA${RESET}`;
  // Con una sola corrida, "1/1" solo estorba.
  const cuenta =
    agregado.corridas > 1 ? ` ${agregado.completas}/${agregado.corridas}` : '';
  console.log(
    `${marca}${cuenta} ${agregado.caso.id} ${GRIS}— ${agregado.caso.descripcion}${RESET}`,
  );
  for (const c of agregado.criterios.filter((c) => c.ok < c.total)) {
    const veces = agregado.corridas > 1 ? `${c.ok}/${c.total} ` : '';
    console.log(`      ${ROJO}✗${RESET} ${veces}${c.criterio}`);
    if (c.detalle) {
      console.log(`        ${GRIS}${c.detalle}${RESET}`);
    }
  }
  if (agregado.enviadoEnFallo !== undefined) {
    console.log(
      `        ${GRIS}envió: ${agregado.enviadoEnFallo.slice(0, 200)}${RESET}`,
    );
  }
  if (agregado.accionesEnFallo !== undefined) {
    console.log(`        ${GRIS}usó: ${agregado.accionesEnFallo}${RESET}`);
  }
  if (agregado.hechosEnFallo !== undefined) {
    console.log(`        ${GRIS}anotó: ${agregado.hechosEnFallo}${RESET}`);
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
  // Igual que en producción: se lee del entorno. Para comparar modelos basta
  // anteponer las variables (`ANTHROPIC_MODEL=… ANTHROPIC_TOOL_CHOICE=auto`).
  const toolChoice =
    process.env.ANTHROPIC_TOOL_CHOICE === 'auto' ? 'auto' : 'any';
  console.log(
    `Modelo: ${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'} · ` +
      `tool_choice: ${toolChoice}\n`,
  );
  const totales: Array<{ nombre: string; texto: string; todoOk: boolean }> = [];
  const veces =
    args.repeticiones > 1 ? `, ${args.repeticiones} veces cada uno` : '';
  for (const condicion of condiciones) {
    console.log(
      `Evaluando ${casos.length} casos${veces} (${condicion.nombre})...\n`,
    );
    const agregados: Agregado[] = [];
    for (const caso of casos) {
      const corridas: EvalResult[] = [];
      for (let i = 0; i < args.repeticiones; i++) {
        corridas.push(
          await evaluar(caso, anthropic, { sin: condicion.sin, toolChoice }),
        );
      }
      const agregado = agregarCorridas(corridas);
      agregados.push(agregado);
      imprimir(agregado);
    }

    const completas = agregados.reduce((n, a) => n + a.completas, 0);
    const corridas = agregados.reduce((n, a) => n + a.corridas, 0);
    const criterios = agregados.flatMap((a) => a.criterios);
    const okChecks = criterios.reduce((n, c) => n + c.ok, 0);
    const totalChecks = criterios.reduce((n, c) => n + c.total, 0);
    const texto =
      `${completas}/${corridas} corridas completas · ` +
      `${okChecks}/${totalChecks} criterios`;
    console.log(`\n${texto}\n`);
    totales.push({
      nombre: condicion.nombre,
      texto,
      todoOk: completas === corridas,
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
