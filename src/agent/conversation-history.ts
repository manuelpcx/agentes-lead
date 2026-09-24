import Anthropic from '@anthropic-ai/sdk';
import { Channel, Direction } from '@prisma/client';
import { safeTimezone } from '../followup/business-hours';

/**
 * Armado del historial que ve el modelo.
 *
 * Cada mensaje va anotado con su canal, cuánto hace que ocurrió y quién lo
 * escribió. Sin eso el modelo recibía una lista plana de textos: no podía
 * distinguir un correo de un WhatsApp ni de una transcripción de llamada, no
 * sabía si el último mensaje era de hace dos minutos o de hace dos semanas, y
 * daba por propios los mensajes que había escrito un operador desde el panel.
 */

/** Cuántas interacciones recientes (las ÚLTIMAS) ve el modelo como historial. */
export const HISTORY_LIMIT = 30;

/**
 * Tope de caracteres del historial completo. Una sola transcripción de llamada
 * puede traer miles de caracteres: sin tope, dos llamadas llenan la ventana y
 * desplazan la conversación reciente de WhatsApp.
 */
export const HISTORY_MAX_CHARS = 12_000;

/** Tope por mensaje individual (se conserva el inicio, que es lo que resume). */
export const MAX_MESSAGE_CHARS = 2_000;

/** Una interacción tal como la necesita el armado del historial. */
export interface HistoryRow {
  direction: Direction;
  channel: Channel;
  content: string;
  occurredAt: Date;
  /** `byUserId` marca los mensajes escritos por un operador desde el panel. */
  metadata?: unknown;
}

export interface HistoryOptions {
  now?: Date;
  timezone?: string;
  maxChars?: number;
}

const CHANNEL_LABELS: Partial<Record<Channel, string>> = {
  [Channel.whatsapp]: 'WhatsApp',
  [Channel.email]: 'Correo',
  [Channel.call]: 'Llamada',
};

/**
 * Reconoce una anotación al inicio de un texto. Se usa para quitarla de los
 * mensajes salientes: el modelo ve el formato en cada línea del historial y
 * podría copiarlo al redactar, y eso llegaría tal cual al cliente.
 */
const ANNOTATION_RE =
  /^\[(?:Operador · )?(?:WhatsApp|Correo|Llamada) · [^\]]{1,40}\]\s*/;

/** Quita la anotación del sistema si el modelo la copió al redactar. */
export function stripSystemAnnotation(text: string): string {
  return text.replace(ANNOTATION_RE, '');
}

/** Fecha corta en la zona del lead, para lo que ya no se mide en días. */
function shortDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: safeTimezone(timezone),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Antigüedad legible: relativa mientras sea reciente, fecha cuando ya no lo es.
 * Es lo que le permite al agente no saludar como si nada tras dos semanas de
 * silencio, ni decir "como te decía" sobre algo de hace un mes.
 */
export function formatAge(
  occurredAt: Date,
  now: Date,
  timezone = 'America/Santiago',
): string {
  const diffMs = now.getTime() - occurredAt.getTime();
  if (diffMs < 60_000) {
    return 'recién'; // incluye relojes levemente desfasados (diferencia < 0)
  }
  const minutos = Math.floor(diffMs / 60_000);
  if (minutos < 60) {
    return `hace ${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    return `hace ${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  if (dias < 7) {
    return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }
  return shortDate(occurredAt, timezone);
}

/** true si la escribió una persona del equipo desde el panel, no el agente. */
export function isFromOperator(row: HistoryRow): boolean {
  if (row.direction !== Direction.outbound) {
    return false;
  }
  const meta = row.metadata;
  return !!meta && typeof meta === 'object' && 'byUserId' in (meta as object);
}

/** `[WhatsApp · hace 5 min]` o `[Operador · WhatsApp · hace 5 min]`. */
export function annotate(
  row: HistoryRow,
  now: Date,
  timezone?: string,
): string {
  const canal = CHANNEL_LABELS[row.channel] ?? 'WhatsApp';
  const quien = isFromOperator(row) ? 'Operador · ' : '';
  return `[${quien}${canal} · ${formatAge(row.occurredAt, now, timezone)}] ${row.content}`;
}

/**
 * Prefijo de las instrucciones que le da el SISTEMA al agente (seguimiento,
 * llamada agendada, verificar una promesa). Van en un turno `user` porque es
 * el único rol que la API acepta al final, pero no las escribió el cliente:
 * sin esta marca el agente puede responderlas como si fueran un mensaje suyo.
 */
export const SYSTEM_INSTRUCTION_PREFIX =
  '[INSTRUCCIÓN DEL SISTEMA — no es un mensaje del cliente]';

/**
 * Agrega una instrucción del sistema como turno `user`, fusionándola con el
 * último si ya era `user` (la API espera turnos alternados).
 */
export function appendSystemInstruction(
  messages: Anthropic.MessageParam[],
  instruction: string,
): Anthropic.MessageParam[] {
  const texto = `${SYSTEM_INSTRUCTION_PREFIX} ${instruction}`;
  const ultimo = messages[messages.length - 1];
  if (ultimo?.role === 'user') {
    ultimo.content = `${ultimo.content as string}
${texto}`;
    return messages;
  }
  messages.push({ role: 'user', content: texto });
  return messages;
}

/** Recorta un mensaje demasiado largo dejando constancia del corte. */
function trimContent(content: string, max = MAX_MESSAGE_CHARS): string {
  return content.length <= max
    ? content
    : `${content.slice(0, max)}\n[…mensaje recortado]`;
}

/**
 * Convierte interacciones (en orden ascendente, de la más antigua a la más
 * reciente) en mensajes user/assistant anotados, aplicando el presupuesto de
 * caracteres y las reglas de forma de la API.
 *
 * El presupuesto se consume desde el FINAL: lo que se descarta es siempre lo
 * más antiguo. Lo último que dijo el cliente nunca puede quedar fuera — ese
 * era justamente el error del recorte anterior, que tomaba las primeras N
 * interacciones y dejaba al agente respondiendo a un mensaje viejo.
 *
 * Además garantiza que la lista empiece y termine en un turno `user`: la API
 * de Anthropic exige que el último mensaje sea `user`, y un turno saliente
 * final sin respuesta del cliente (p. ej. el aviso fijo que deja
 * `derivarAAgente`) rompería esa condición.
 */
export function buildHistoryWindow(
  interactions: HistoryRow[],
  options: HistoryOptions = {},
): Anthropic.MessageParam[] {
  const now = options.now ?? new Date();
  const maxChars = options.maxChars ?? HISTORY_MAX_CHARS;

  const all: Anthropic.MessageParam[] = interactions.map((row) => ({
    role: row.direction === Direction.inbound ? 'user' : 'assistant',
    content: annotate(
      { ...row, content: trimContent(row.content) },
      now,
      options.timezone,
    ),
  }));

  let used = 0;
  let from = all.length;
  for (let i = all.length - 1; i >= 0; i--) {
    const size = (all[i].content as string).length;
    // El mensaje más reciente entra siempre, aunque por sí solo pase el tope.
    if (from < all.length && used + size > maxChars) {
      break;
    }
    used += size;
    from = i;
  }

  // Fusiona turnos seguidos del mismo rol. Con la ventana de agrupación, una
  // ráfaga del cliente llega como varios mensajes `user` consecutivos; la API
  // espera turnos alternados, y cada línea conserva su propia anotación.
  const messages: Anthropic.MessageParam[] = [];
  for (const mensaje of all.slice(from)) {
    const previo = messages[messages.length - 1];
    if (previo && previo.role === mensaje.role) {
      previo.content = `${previo.content as string}\n${mensaje.content as string}`;
    } else {
      messages.push({ ...mensaje });
    }
  }

  while (messages.length > 0 && messages[0].role === 'assistant') {
    messages.shift();
  }
  while (
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant'
  ) {
    messages.pop();
  }
  return messages;
}
