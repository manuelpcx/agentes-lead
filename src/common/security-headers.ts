import type { NextFunction, Request, Response } from 'express';

/**
 * Cabeceras de seguridad de la API. Sin `helmet` a propósito (no se pueden
 * instalar dependencias en este árbol); son seis cabeceras fijas.
 *
 * La API solo devuelve JSON, así que la CSP es la más cerrada posible: si un
 * navegador llegara a renderizar una respuesta (un error, un enlace pegado),
 * no puede ejecutar nada ni ser embebida en un iframe.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Un año. Railway termina TLS: el navegador ve https y la cabecera aplica.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
}
