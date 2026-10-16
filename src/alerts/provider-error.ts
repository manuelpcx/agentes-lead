/** Qué tan grave es un fallo de un proveedor externo. */
export type ProviderErrorKind = 'account' | 'transient' | 'request';

/**
 * Error de un proveedor externo (WhatsApp, correo, voz) con el código HTTP y
 * el código propio del proveedor. El mensaje es el legible de siempre; los
 * códigos sirven para clasificar el fallo sin adivinar por el texto.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderErrorClass {
  kind: ProviderErrorKind;
  /** Motivo legible para la persona. */
  reason: string;
  /** Qué hacer, si se sabe. */
  hint?: string;
}

/**
 * Señales de un problema de la CUENTA en el texto o el código del error. Van
 * antes que el código HTTP: ElevenLabs, por ejemplo, devuelve el rechazo de
 * Twilio dentro de una respuesta 4xx genérica. El orden importa: de lo más
 * específico a lo más general.
 */
const ACCOUNT_SIGNALS: Array<{
  re: RegExp;
  reason: (p: string) => string;
  hint: (p: string) => string;
}> = [
  {
    re: /BALANCE_INSUFFICIENT|balance is insufficient/i,
    reason: (p) => `La cuenta de ${p} no tiene saldo.`,
    hint: (p) => `Recarga saldo en ${p}.`,
  },
  {
    re: /credit balance is too low/i,
    reason: (p) => `La cuenta de ${p} no tiene crédito.`,
    hint: (p) => `Recarga crédito en ${p}.`,
  },
  {
    re: /account \S+ with status \S+ is not active/i,
    reason: () => 'La cuenta de Twilio está suspendida o inactiva.',
    hint: () => 'Revisa el estado y la facturación de la cuenta de Twilio.',
  },
  {
    re: /not active|suspended|deactivated|account (has been |is )?(locked|restricted|disabled)/i,
    reason: (p) => `La cuenta de ${p} está suspendida o inactiva.`,
    hint: (p) => `Revisa el estado de la cuenta en ${p}.`,
  },
  {
    // Solo la cuota del REMITENTE: "mailbox is over quota" es del destinatario
    // (ver RECIPIENT_MAILBOX) y no dice nada de la cuenta.
    re: /quota exceeded|exceeded (the |your )?(\w+ )?quota|sending (quota|limit)|daily .*(quota|limit)|insufficient (credit|balance|funds)/i,
    reason: (p) => `La cuenta de ${p} llegó a su límite.`,
    hint: (p) => `Revisa el plan y el consumo en ${p}.`,
  },
];

/** Buzón del destinatario lleno: un rebote de ese correo, no de la cuenta. */
const RECIPIENT_MAILBOX = /over quota|mailbox (is )?full|mailbox .*quota/i;

/**
 * Códigos propios de Meta (Cloud API) que llegan con HTTP 400 aunque no sean
 * errores del mensaje: cuenta bloqueada o sin pago, y límites de envío.
 * El 131056 (límite con un destinatario puntual) queda fuera a propósito: es
 * de ese lead. https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const META_CODES: Record<string, ProviderErrorClass> = {
  '131031': {
    kind: 'account',
    reason: 'La cuenta de WhatsApp Business está bloqueada en Meta.',
    hint: 'Revisa el estado de la cuenta en Meta Business Suite.',
  },
  '133010': {
    kind: 'account',
    reason: 'El número de WhatsApp no está registrado en la cuenta de Meta.',
    hint: 'Revisa el registro del número en Meta Business Suite.',
  },
  '131042': {
    kind: 'account',
    reason: 'La cuenta de WhatsApp Business tiene un problema de pago en Meta.',
    hint: 'Revisa el método de pago en Meta Business Suite.',
  },
  '368': {
    kind: 'account',
    reason: 'Meta bloqueó temporalmente la cuenta por sus políticas.',
    hint: 'Revisa la calidad y las políticas en Meta Business Suite.',
  },
  '130429': {
    kind: 'transient',
    reason: 'Meta está limitando los envíos por segundo.',
  },
  '131048': {
    kind: 'transient',
    reason: 'Meta está limitando los envíos por spam.',
  },
  '80007': {
    kind: 'transient',
    reason: 'Meta está limitando los envíos de la cuenta.',
  },
  '4': {
    kind: 'transient',
    reason: 'Meta está limitando las llamadas de la app.',
  },
};

/** Códigos de red (Node, nodemailer) que indican que no se pudo conectar. */
const NETWORK_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKET',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * Clasifica un fallo de un proveedor:
 *  - `account`: problema de la cuenta (saldo, clave, suspensión). Abre un
 *    incidente al primer fallo.
 *  - `transient`: el proveedor está caído o limitando. Abre tras varios
 *    fallos seguidos.
 *  - `request`: problema de ese envío en particular (teléfono inválido…), o
 *    un error sin señales que puede ser nuestro. No culpa al proveedor.
 * Acepta cualquier error: si no es `ProviderError`, lee `status` del objeto
 * (SDK de Anthropic) o del texto ("(Vapi 503)").
 */
export function classifyProviderError(
  error: unknown,
  providerLabel: string,
): ProviderErrorClass {
  const p = providerLabel;
  const e = (error ?? {}) as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const message = typeof e.message === 'string' ? e.message : String(error);
  const code = typeof e.code === 'string' ? e.code : '';
  const haystack = `${code} ${message}`;

  if (META_CODES[code]) {
    return META_CODES[code];
  }
  if (RECIPIENT_MAILBOX.test(message)) {
    return { kind: 'request', reason: message };
  }
  for (const signal of ACCOUNT_SIGNALS) {
    if (signal.re.test(haystack)) {
      return {
        kind: 'account',
        reason: signal.reason(p),
        hint: signal.hint(p),
      };
    }
  }
  if (code === 'EAUTH') {
    return {
      kind: 'account',
      reason: `${p} rechazó el usuario o la contraseña.`,
      hint: `Revisa las credenciales de ${p}.`,
    };
  }

  const status =
    typeof e.status === 'number' ? e.status : statusFromMessage(message);
  if (status === 401) {
    return {
      kind: 'account',
      reason: `${p} rechazó la clave de acceso.`,
      hint: `Revisa la clave configurada para ${p}.`,
    };
  }
  if (status === 402) {
    return {
      kind: 'account',
      reason: `La cuenta de ${p} tiene un problema de pago.`,
      hint: `Revisa la facturación en ${p}.`,
    };
  }
  if (status === 403) {
    return {
      kind: 'account',
      reason: `${p} rechazó el envío por un problema de la cuenta.`,
      hint: `Revisa el estado de la cuenta en ${p}.`,
    };
  }
  if (status === 429) {
    return {
      kind: 'transient',
      reason: `${p} está limitando los envíos por exceso de solicitudes.`,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: 'transient',
      reason: `${p} está fallando (error ${status}).`,
    };
  }
  if (status !== undefined && status >= 400) {
    return { kind: 'request', reason: message };
  }

  if (
    NETWORK_CODES.has(code) ||
    e.name === 'APIConnectionError' ||
    e.name === 'APIConnectionTimeoutError' ||
    /fetch failed|connection error|timed? ?out|socket hang up/i.test(message)
  ) {
    return { kind: 'transient', reason: `No se pudo conectar con ${p}.` };
  }
  return { kind: 'request', reason: message };
}

/** "(YCloud 403: …)" o "(ElevenLabs 400 al leer …)" → 403 / 400. */
function statusFromMessage(message: string): number | undefined {
  const m = /\((?:[A-Za-z]+ )?([1-5]\d\d)\b/.exec(message);
  return m ? Number(m[1]) : undefined;
}
