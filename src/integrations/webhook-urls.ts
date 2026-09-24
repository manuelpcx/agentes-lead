import type { Request } from 'express';

/**
 * Rutas de los webhooks de entrada, tal como las declaran `WhatsappController`
 * y `VoiceController`. Un test verifica que no se desfasen de los controllers:
 * si alguien cambia una ruta, el panel no puede seguir mostrando la vieja.
 */
export const WEBHOOK_PATHS = {
  whatsapp: {
    ycloud: '/whatsapp/ycloud/webhook',
    meta: '/whatsapp/webhook',
  },
  voice: {
    retell: '/voice/retell/webhook',
    vapi: '/voice/vapi/webhook',
  },
} as const;

/** Lo que el cliente tiene que pegar en el panel de cada proveedor. */
export interface WebhookInfo {
  baseUrl: string;
  /**
   * La URL apunta a esta misma máquina (desarrollo): ningún proveedor externo
   * puede llegar a ella. El panel lo advierte.
   */
  local: boolean;
  whatsapp: {
    ycloud: { url: string; events: string[] };
    meta: { url: string; verifyToken: string | null; fields: string[] };
  };
  voice: {
    retell: { url: string; events: string[] };
    vapi: { url: string; events: string[] };
  };
}

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
]);

/** Primer valor de una cabecera que puede venir repetida o como lista. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * URL pública del backend. Manda `PUBLIC_API_URL` si está configurada; si no,
 * se deduce de la petición del panel (que llega al mismo backend que recibirá
 * los webhooks), respetando las cabeceras del proxy de Railway o Cloud Run.
 */
export function publicBaseUrl(
  configured: string | undefined,
  req: Pick<Request, 'headers' | 'protocol'>,
): string {
  if (configured?.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  const proto = firstHeader(req.headers['x-forwarded-proto']) ?? req.protocol;
  const host =
    firstHeader(req.headers['x-forwarded-host']) ??
    firstHeader(req.headers.host) ??
    'localhost';
  return `${proto}://${host}`;
}

/** Arma las URLs de webhook de cada proveedor sobre la URL pública. */
export function buildWebhookInfo(
  baseUrl: string,
  metaVerifyToken?: string | null,
): WebhookInfo {
  let hostname = '';
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    // Una URL mal formada se muestra igual; el panel la verá rara.
  }
  return {
    baseUrl,
    local: LOCAL_HOSTS.has(hostname) || hostname.startsWith('127.'),
    whatsapp: {
      ycloud: {
        url: baseUrl + WEBHOOK_PATHS.whatsapp.ycloud,
        // El único evento que procesa el controller; los demás se ignoran.
        events: ['whatsapp.inbound_message.received'],
      },
      meta: {
        url: baseUrl + WEBHOOK_PATHS.whatsapp.meta,
        verifyToken: metaVerifyToken?.trim() || null,
        fields: ['messages'],
      },
    },
    voice: {
      retell: {
        url: baseUrl + WEBHOOK_PATHS.voice.retell,
        events: ['call_analyzed'],
      },
      vapi: {
        url: baseUrl + WEBHOOK_PATHS.voice.vapi,
        events: ['end-of-call-report'],
      },
    },
  };
}
