import { ProviderError } from '../../alerts/provider-error';

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
 * problema era, por ejemplo, la falta de saldo. Lleva además el código HTTP y
 * el del proveedor, para clasificar el fallo (alertas de proveedores).
 */
export function whatsappSendError(
  provider: 'YCloud' | 'Meta',
  status: number,
  detail: string,
): ProviderError {
  const { reason, code } = readReason(detail);
  return new ProviderError(
    `Fallo al enviar WhatsApp (${provider} ${status}${reason ? `: ${reason}` : ''})`,
    status,
    code,
  );
}

/** Lee `{ error: { code, message } }`, el formato de YCloud y de Meta. */
function readReason(detail: string): { reason: string | null; code?: string } {
  let body: unknown;
  try {
    body = JSON.parse(detail);
  } catch {
    return { reason: null };
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } })
    ?.error;
  if (!error) return { reason: null };
  const code =
    typeof error.code === 'string' || typeof error.code === 'number'
      ? String(error.code)
      : undefined;
  if (typeof error.code === 'string' && KNOWN_REASONS[error.code]) {
    return { reason: KNOWN_REASONS[error.code], code };
  }
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  return { reason: message ? message.slice(0, 200) : null, code };
}
