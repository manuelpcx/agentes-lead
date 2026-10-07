/**
 * Escalera de canales del seguimiento (Fase 4+). Decide por qué canal contacta
 * el agente en cada intento y construye la instrucción proactiva. Correo es el
 * canal fiable para leads fríos (WhatsApp libre solo entra dentro de la ventana
 * de 24h). El agente ejecuta con la herramienta correspondiente.
 */

export type FollowUpChannel = 'email' | 'whatsapp' | 'call';

const VALID: FollowUpChannel[] = ['email', 'whatsapp', 'call'];

/** Escalera por defecto (índice = intento): correo, WhatsApp, WhatsApp, correo. */
export const DEFAULT_LADDER: FollowUpChannel[] = [
  'email',
  'whatsapp',
  'whatsapp',
  'email',
];

/** Parsea `FOLLOWUP_CHANNEL_LADDER` (coma-separado). Cae al default si es inválida. */
export function parseLadder(raw: string | undefined): FollowUpChannel[] {
  if (!raw) {
    return DEFAULT_LADDER;
  }
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((c): c is FollowUpChannel => VALID.includes(c as FollowUpChannel));
  return parsed.length > 0 ? parsed : DEFAULT_LADDER;
}

/**
 * Parsea `FOLLOWUP_DELAYS_HOURS` (coma-separado) a horas por intento. Descarta
 * valores no numéricos o no positivos. Lista vacía = usar el espaciado creciente
 * por defecto (`baseDelayHours * intento`).
 */
export function parseDelaysHours(raw: string | undefined): number[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Con qué se puede contactar al lead en este intento. */
export interface FollowUpReach {
  hasEmail: boolean;
  hasPhone: boolean;
  /**
   * La empresa puede llamar ahora (tiene voz y, si es la gestionada, minutos
   * y cupo). Si no, la llamada de la escalera cae a otro canal en vez de
   * gastar el intento en una llamada que no va a salir.
   */
  canCall?: boolean;
}

/** Un canal es usable si el lead tiene el dato de contacto que necesita. */
function canUse(channel: FollowUpChannel, reach: FollowUpReach): boolean {
  if (channel === 'email') {
    return reach.hasEmail;
  }
  if (channel === 'call') {
    return reach.hasPhone && reach.canCall !== false;
  }
  return reach.hasPhone;
}

/**
 * Resuelve el canal para el intento dado (1-indexed). Usa el canal de la
 * escalera si el lead es contactable por él; si no, cae a otro canal disponible
 * (correo → WhatsApp → llamada). Devuelve null si el lead no tiene ningún dato
 * de contacto (inalcanzable).
 */
export function resolveFollowUpChannel(
  attempt: number,
  ladder: FollowUpChannel[],
  reach: FollowUpReach,
): FollowUpChannel | null {
  const preferred = ladder[(attempt - 1) % ladder.length];
  if (canUse(preferred, reach)) {
    return preferred;
  }
  for (const fallback of VALID) {
    if (fallback !== preferred && canUse(fallback, reach)) {
      return fallback;
    }
  }
  return null;
}

interface ChannelMeta {
  label: string;
  tool: string;
  accion: string;
}

const CHANNEL_META: Record<FollowUpChannel, ChannelMeta> = {
  email: { label: 'CORREO', tool: 'enviarCorreo', accion: 'un correo' },
  whatsapp: {
    label: 'WHATSAPP',
    tool: 'enviarWhatsApp',
    accion: 'un WhatsApp',
  },
  call: { label: 'LLAMADA', tool: 'iniciarLlamada', accion: 'una llamada' },
};

/** Instrucción proactiva para el agente, específica del canal e intento. */
export function buildFollowUpInstruction(params: {
  channel: FollowUpChannel;
  attempt: number;
  maxAttempts: number;
  primerContacto: boolean;
  source?: string | null;
  /** Agente de cobranza: cada contacto proactivo es una gestión con tope legal. */
  cobranza?: boolean;
}): string {
  const { channel, attempt, maxAttempts, primerContacto, source, cobranza } =
    params;
  const m = CHANNEL_META[channel];
  // Un segundo envío en el mismo turno sería otra gestión: el sistema lo
  // bloquearía igual, pero es mejor que el agente ni lo intente.
  const limiteLegal = cobranza
    ? ` Límite legal de cobranza: haz solo ${m.accion} en este turno y no ` +
      `contactes por otros canales.`
    : '';
  if (primerContacto) {
    return (
      `[PRIMER CONTACTO · ${m.label}] Este lead (origen: ${source ?? 'desconocido'}) ` +
      `aún no ha conversado contigo. Preséntate de forma breve y cálida enviando ${m.accion} ` +
      `(usa la herramienta ${m.tool}) y ofrece ayuda para iniciar la conversación. No seas ` +
      `invasivo. Respalda cualquier dato con tus herramientas.` +
      limiteLegal
    );
  }
  return (
    `[SEGUIMIENTO ${attempt}/${maxAttempts} · ${m.label}] El cliente no ha respondido a tu ` +
    `último mensaje. Retoma el contacto enviando ${m.accion} breve (usa la herramienta ${m.tool}). ` +
    `Si ya no tiene sentido insistir, no envíes nada (el sistema lo cerrará más adelante). ` +
    `Respalda cualquier dato con tus herramientas.` +
    limiteLegal
  );
}
