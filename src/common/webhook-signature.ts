import { createHmac, timingSafeEqual } from 'node:crypto';

/** Tolerancia de reloj para el timestamp de la firma (evita ataques de repetición). */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Comparación en tiempo constante de dos hex strings (evita timing attacks). */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Firma un cuerpo saliente (HMAC-SHA256 hex) con el secreto de la empresa —
 * usada para los eventos que ENVIAMOS al CRM del cliente (mismo esquema que
 * exigimos a Retell/YCloud, pero en el sentido inverso: aquí somos el emisor).
 * El destinatario recompone el mismo cálculo para verificar el header `X-Signature`.
 */
export function signHmacSha256Hex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifica la firma de un webhook de Retell (`x-retell-signature`).
 * Header: "v={timestamp_ms},d={hmac_sha256_hex}". Firma sobre `rawBody + timestamp`
 * (concatenación literal, sin separador), con la API key de la cuenta como clave.
 * Doc: https://docs.retellai.com/features/secure-webhook
 */
export function verifyRetellSignature(
  rawBody: Buffer,
  header: string | undefined,
  apiKey: string,
): boolean {
  if (!header) {
    return false;
  }
  const match = /^v=(\d+),d=(.+)$/.exec(header.trim());
  if (!match) {
    return false;
  }
  const [, tsStr, digest] = match;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return false;
  }
  const expected = createHmac('sha256', apiKey)
    .update(Buffer.concat([rawBody, Buffer.from(tsStr)]))
    .digest('hex');
  return safeEquals(digest, expected);
}

/**
 * Verifica la firma de un webhook de YCloud (`YCloud-Signature`).
 * Header: "t={timestamp_s},s={hmac_sha256_hex}". Firma sobre `{timestamp}.{rawBody}`,
 * con el secreto del endpoint de webhook (distinto de la API key) como clave.
 * Doc: https://docs.ycloud.com/reference/webhook-integration-guide
 */
export function verifyYCloudSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) {
    return false;
  }
  const match = /^t=(\d+),s=(.+)$/.exec(header.trim());
  if (!match) {
    return false;
  }
  const [, tsStr, sig] = match;
  const tsMs = Number(tsStr) * 1000; // YCloud usa segundos
  if (
    !Number.isFinite(tsMs) ||
    Math.abs(Date.now() - tsMs) > MAX_CLOCK_SKEW_MS
  ) {
    return false;
  }
  const signedPayload = Buffer.concat([Buffer.from(`${tsStr}.`), rawBody]);
  const expected = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return safeEquals(sig, expected);
}

/**
 * Verifica la firma de un webhook de Meta (WhatsApp Cloud API):
 * header `X-Hub-Signature-256` = "sha256={hmac_sha256_hex}" sobre el cuerpo
 * crudo, con el **App Secret** de la app de Meta como clave (no el token de
 * acceso). Doc: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header) {
    return false;
  }
  const match = /^sha256=([0-9a-f]+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  return safeEquals(match[1].toLowerCase(), expected);
}

/**
 * Ventana de ElevenLabs para el timestamp de su firma. Es la que usa su propio
 * SDK: reintenta entregas fallidas, así que los 5 min del resto rechazarían
 * reintentos legítimos.
 */
const ELEVENLABS_MAX_SKEW_MS = 30 * 60 * 1000;

/**
 * Verifica la firma de un webhook de ElevenLabs Agents (`elevenlabs-signature`).
 * Header: "t={timestamp_s},v0={hmac_sha256_hex}". Firma sobre `{timestamp}.{rawBody}`
 * con el secreto HMAC del webhook. Mientras ElevenLabs rota el secreto, el
 * header trae dos `v0=` (viejo y nuevo): basta con que calce uno.
 * Doc: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
 */
export function verifyElevenLabsSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) {
    return false;
  }
  const parts = header.split(',').map((p) => p.trim());
  const tsStr = parts.find((p) => p.startsWith('t='))?.slice(2) ?? '';
  const firmas = parts
    .filter((p) => p.startsWith('v0='))
    .map((p) => p.slice(3));
  if (!/^\d{1,12}$/.test(tsStr) || firmas.length === 0) {
    return false;
  }
  const tsMs = Number(tsStr) * 1000; // ElevenLabs usa segundos
  if (Math.abs(Date.now() - tsMs) > ELEVENLABS_MAX_SKEW_MS) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${tsStr}.`), rawBody]))
    .digest('hex');
  return firmas.some((f) => safeEquals(f, expected));
}

/**
 * Verifica un secreto compartido enviado tal cual en un header (Vapi manda
 * el "Server URL Secret" en `x-vapi-secret`). Comparación en tiempo constante.
 */
export function verifySharedSecret(
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) {
    return false;
  }
  return safeEquals(header.trim(), secret);
}

/**
 * Firma de entrada **v1** (webhooks del cliente hacia nosotros, esquema
 * original): HMAC-SHA256 hex del cuerpo crudo. Sin timestamp, una petición
 * capturada sirve para siempre. Se mantiene por compatibilidad mientras
 * `WEBHOOK_REQUIRE_TIMESTAMP` sea false.
 */
export function verifyCompanySignatureV1(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEquals(signature.trim().toLowerCase(), expected);
}

/** Firma de entrada **v2**: HMAC-SHA256 hex de `"<timestampMs>." + cuerpo`. */
export function signCompanyPayload(
  secret: string,
  timestampMs: string | number,
  rawBody: Buffer | string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestampMs}.`)
    .update(rawBody)
    .digest('hex');
}

/**
 * Verifica la firma v2 y que `X-Timestamp` (ms Unix) esté dentro de ±5 min.
 * Como el timestamp entra en la firma, no se puede cambiar sin invalidarla:
 * una petición capturada deja de servir cuando vence la ventana.
 */
export function verifyCompanySignatureV2(
  rawBody: Buffer,
  signature: string,
  timestamp: string,
  secret: string,
): boolean {
  const ts = timestamp.trim();
  if (!/^\d{1,16}$/.test(ts)) {
    return false;
  }
  const tsMs = Number(ts);
  if (
    !Number.isFinite(tsMs) ||
    Math.abs(Date.now() - tsMs) > MAX_CLOCK_SKEW_MS
  ) {
    return false;
  }
  return safeEquals(
    signature.trim().toLowerCase(),
    signCompanyPayload(secret, ts, rawBody),
  );
}
