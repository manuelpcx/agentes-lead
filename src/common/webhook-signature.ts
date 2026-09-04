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
