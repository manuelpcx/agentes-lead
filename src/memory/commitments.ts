/**
 * Compromisos con fecha: lo que la persona prometió ("te pago el viernes") o
 * pidió ("escríbeme en marzo"). A diferencia de un hecho, un compromiso vence:
 * llegado el día hay que retomarlo, y pasado sin confirmar ya no se puede
 * presentar como vigente. Lógica pura, sin base de datos.
 */
import { parseInZone } from '../followup/business-hours';

export type TipoCompromiso = 'pago' | 'recontacto';
export type EstadoCompromiso =
  'pendiente' | 'cumplido' | 'incumplido' | 'cancelado';

export const ESTADOS_FINALES: readonly EstadoCompromiso[] = [
  'cumplido',
  'incumplido',
  'cancelado',
];

export interface Compromiso {
  /** Corto y estable ("c1", "c2"…): el agente lo usa para actualizarlo. */
  id: string;
  tipo: TipoCompromiso;
  /** Qué se acordó, en una frase. */
  texto: string;
  /** Día acordado, `YYYY-MM-DD` en la zona del lead. */
  fecha: string;
  /** ISO del momento en que el seguimiento lo retoma. */
  venceEn: string;
  /** `HH:MM` local si la persona pidió una hora ("a las 10"). */
  hora?: string;
  estado: EstadoCompromiso;
  creadoEn: string;
  resueltoEn?: string;
}

/** Tope de compromisos guardados: pasado, se olvidan los resueltos más viejos. */
export const MAX_COMPROMISOS = 10;
/** Cuánto tiempo se le sigue mostrando al agente un compromiso ya resuelto. */
export const HISTORIAL_DIAS = 30;
/** Hora local a la que se retoma un compromiso el día acordado. */
export const HORA_DE_RETOMA = 10;
export const MAX_TEXTO_CHARS = 200;

const DIA_MS = 24 * 3_600_000;
const TIPOS: readonly TipoCompromiso[] = ['pago', 'recontacto'];
const ESTADOS: readonly EstadoCompromiso[] = ['pendiente', ...ESTADOS_FINALES];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** `YYYY-MM-DD` de `instante` en la zona dada. */
export function fechaLocal(instante: Date, timezone: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  return new Date(d.getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Cuándo retomar un compromiso del día `fecha`: a las `HORA_DE_RETOMA` de ese
 * día en la zona del lead (el seguimiento lo corre al horario hábil si cae
 * fuera). Si la fecha es hoy, mañana: "te pago hoy" se verifica al día
 * siguiente, no minutos después de acordarlo.
 *
 * Devuelve un error legible si la fecha no sirve.
 */
export function calcularVencimiento(
  fecha: string,
  timezone: string,
  now = new Date(),
  hora?: string,
): { venceEn: Date } | { error: string } {
  const texto = fecha.trim();
  if (!FECHA.test(texto) || Number.isNaN(Date.parse(`${texto}T00:00:00Z`))) {
    return { error: `Fecha inválida "${fecha}". Usa formato "YYYY-MM-DD".` };
  }
  const hoy = fechaLocal(now, timezone);
  if (texto < hoy) {
    return {
      error: `La fecha ${texto} ya pasó (hoy es ${hoy}). Confirma la fecha con la persona.`,
    };
  }
  // Hora pedida por la persona ("escríbeme a las 10"): se respeta tal cual,
  // también hoy si todavía no llega.
  if (hora !== undefined && hora.trim() !== '') {
    const h = hora.trim();
    if (!HORA.test(h)) {
      return { error: `Hora inválida "${hora}". Usa formato "HH:MM" (24 h).` };
    }
    const venceEn = parseInZone(`${texto}T${h.padStart(5, '0')}`, timezone);
    if (!venceEn) {
      return { error: `Fecha u hora inválida "${fecha} ${hora}".` };
    }
    if (venceEn.getTime() <= now.getTime()) {
      return {
        error: `Esa hora (${texto} ${h}) ya pasó. Confirma con la persona otro momento.`,
      };
    }
    return { venceEn };
  }
  const dia = texto === hoy ? sumarDias(texto, 1) : texto;
  const horaRetoma = String(HORA_DE_RETOMA).padStart(2, '0');
  const venceEn = parseInZone(`${dia}T${horaRetoma}:00`, timezone);
  return venceEn ? { venceEn } : { error: `Fecha inválida "${fecha}".` };
}

/** Lee el JSON guardado, descartando lo que no calce. */
export function parseCompromisos(raw: unknown): Compromiso[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Compromiso[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const c = item as Record<string, unknown>;
    if (
      typeof c.id !== 'string' ||
      !TIPOS.includes(c.tipo as TipoCompromiso) ||
      typeof c.texto !== 'string' ||
      typeof c.fecha !== 'string' ||
      !FECHA.test(c.fecha) ||
      typeof c.venceEn !== 'string' ||
      !ESTADOS.includes(c.estado as EstadoCompromiso)
    ) {
      continue;
    }
    out.push({
      id: c.id,
      tipo: c.tipo as TipoCompromiso,
      texto: c.texto,
      fecha: c.fecha,
      venceEn: c.venceEn,
      estado: c.estado as EstadoCompromiso,
      creadoEn: typeof c.creadoEn === 'string' ? c.creadoEn : c.venceEn,
      ...(typeof c.resueltoEn === 'string' ? { resueltoEn: c.resueltoEn } : {}),
      ...(typeof c.hora === 'string' && HORA.test(c.hora)
        ? { hora: c.hora }
        : {}),
    });
  }
  return out;
}

function siguienteId(lista: Compromiso[]): string {
  const max = lista.reduce((m, c) => {
    const n = /^c(\d+)$/.exec(c.id);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `c${max + 1}`;
}

/** Olvida los resueltos más viejos si se pasa del tope; nunca un pendiente. */
function recortar(lista: Compromiso[]): Compromiso[] {
  const out = [...lista];
  while (out.length > MAX_COMPROMISOS) {
    const resueltos = out
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.estado !== 'pendiente')
      .sort((a, b) =>
        (a.c.resueltoEn ?? a.c.creadoEn).localeCompare(
          b.c.resueltoEn ?? b.c.creadoEn,
        ),
      );
    if (resueltos.length === 0) {
      break;
    }
    out.splice(resueltos[0].i, 1);
  }
  return out;
}

/**
 * Agrega un compromiso. Uno nuevo del mismo tipo reemplaza al pendiente
 * anterior: si el anterior ya había vencido queda `incumplido` (la persona no
 * pagó y da otra fecha), y si no, `cancelado` (lo reprogramó antes de tiempo).
 */
export function agregarCompromiso(
  lista: Compromiso[],
  nuevo: {
    tipo: TipoCompromiso;
    texto: string;
    fecha: string;
    venceEn: Date;
    hora?: string;
  },
  now = new Date(),
): { lista: Compromiso[]; compromiso: Compromiso; reemplazados: Compromiso[] } {
  const ahora = now.toISOString();
  const reemplazados: Compromiso[] = [];
  const actualizada = lista.map((c) => {
    if (c.tipo !== nuevo.tipo || c.estado !== 'pendiente') {
      return c;
    }
    const cerrado: Compromiso = {
      ...c,
      estado: c.venceEn <= ahora ? 'incumplido' : 'cancelado',
      resueltoEn: ahora,
    };
    reemplazados.push(cerrado);
    return cerrado;
  });
  const compromiso: Compromiso = {
    id: siguienteId(lista),
    tipo: nuevo.tipo,
    texto: nuevo.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_CHARS),
    fecha: nuevo.fecha,
    venceEn: nuevo.venceEn.toISOString(),
    ...(nuevo.hora ? { hora: nuevo.hora } : {}),
    estado: 'pendiente',
    creadoEn: ahora,
  };
  return {
    lista: recortar([...actualizada, compromiso]),
    compromiso,
    reemplazados,
  };
}

/** Marca un compromiso como resuelto. `null` si no existe ese id. */
export function resolverCompromiso(
  lista: Compromiso[],
  id: string,
  estado: Exclude<EstadoCompromiso, 'pendiente'>,
  now = new Date(),
): { lista: Compromiso[]; compromiso: Compromiso } | null {
  const i = lista.findIndex((c) => c.id === id.trim());
  if (i === -1) {
    return null;
  }
  const compromiso: Compromiso = {
    ...lista[i],
    estado,
    resueltoEn: now.toISOString(),
  };
  const out = [...lista];
  out[i] = compromiso;
  return { lista: out, compromiso };
}

/**
 * El próximo compromiso pendiente que todavía no llega. Mientras exista, el
 * seguimiento no contacta antes de su fecha: insistir antes de lo que la
 * persona pidió molesta (y en cobranza suma gestiones contra el tope legal).
 */
export function proximoPendiente(
  lista: Compromiso[],
  now = new Date(),
): Compromiso | null {
  const ahora = now.toISOString();
  return (
    lista
      .filter((c) => c.estado === 'pendiente' && c.venceEn > ahora)
      .sort((a, b) => a.venceEn.localeCompare(b.venceEn))[0] ?? null
  );
}

/** El pendiente ya vencido más antiguo: el que el seguimiento debe retomar. */
export function vencidoPendiente(
  lista: Compromiso[],
  now = new Date(),
): Compromiso | null {
  const ahora = now.toISOString();
  return (
    lista
      .filter((c) => c.estado === 'pendiente' && c.venceEn <= ahora)
      .sort((a, b) => a.venceEn.localeCompare(b.venceEn))[0] ?? null
  );
}

function fechaLegible(fecha: string): string {
  // Mediodía UTC: el día no se corre al formatear en ninguna zona de América.
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${fecha}T12:00:00Z`));
}

const NOMBRE: Record<TipoCompromiso, string> = {
  pago: 'Pago',
  recontacto: 'Volver a contactar',
};

/**
 * Bloque para el system prompt. Lo pendiente que no llega se muestra como
 * pendiente; lo vencido sin confirmar, como algo a verificar (no como hecho);
 * lo resuelto en los últimos `HISTORIAL_DIAS`, como historial. '' si no hay
 * nada que mostrar.
 */
export function formatCompromisos(
  lista: Compromiso[],
  timezone: string,
  now = new Date(),
): string {
  const hoy = fechaLocal(now, timezone);
  const desde = new Date(now.getTime() - HISTORIAL_DIAS * DIA_MS).toISOString();
  const lineas: string[] = [];
  for (const c of [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const que = `${NOMBRE[c.tipo]}: "${c.texto}"`;
    if (c.estado === 'pendiente') {
      lineas.push(
        c.fecha >= hoy
          ? `- [${c.id}] ${que} — para el ${fechaLegible(c.fecha)}` +
              `${c.hora ? ` a las ${c.hora}` : ''}. Pendiente.`
          : `- [${c.id}] ${que} — era para el ${fechaLegible(c.fecha)} y no ` +
              'hay confirmación. NO asumas que se cumplió ni que no: ' +
              'verifícalo con tacto.',
      );
    } else if ((c.resueltoEn ?? c.creadoEn) >= desde) {
      lineas.push(`- ${que} — del ${fechaLegible(c.fecha)}: ${c.estado}.`);
    }
  }
  if (lineas.length === 0) {
    return '';
  }
  return (
    `\n\n--- Compromisos con esta persona (hoy es ${fechaLegible(hoy)}) ---\n` +
    `${lineas.join('\n')}\n` +
    'Cuando la persona confirme que se cumplió o que ya no aplica, márcalo ' +
    'con "actualizarCompromiso" usando su id ([c1], [c2]…).'
  );
}
