/**
 * Motivos de rechazo conocidos, en palabras de quien opera el panel. El resto
 * se muestra con el mensaje del proveedor tal cual.
 */
const KNOWN_REASONS: Record<string, string> = {
  BALANCE_INSUFFICIENT: 'la cuenta de YCloud no tiene saldo',
};

/**
 * Error de envío con el motivo que dio el proveedor. Antes solo llevaba el
 * código HTTP ("YCloud 403"), y en el panel no había forma de saber que el
 * problema era, por ejemplo, la falta de saldo.
 */
export function whatsappSendError(
  provider: 'YCloud' | 'Meta',
  status: number,
  detail: string,
): Error {
  const reason = readReason(detail);
  return new Error(
    `Fallo al enviar WhatsApp (${provider} ${status}${reason ? `: ${reason}` : ''})`,
  );
}

/** Lee `{ error: { code, message } }`, el formato de YCloud y de Meta. */
function readReason(detail: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(detail);
  } catch {
    return null;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } })
    ?.error;
  if (!error) return null;
  if (typeof error.code === 'string' && KNOWN_REASONS[error.code]) {
    return KNOWN_REASONS[error.code];
  }
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  return message ? message.slice(0, 200) : null;
}
