import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Largo de la ventana, en segundos. */
  windowSec: number;
  /**
   * Por quién se cuenta:
   * - `ip` (default): por dirección de origen. Para rutas públicas.
   * - `auth`: por credencial (hash del JWT o de la llave de API). Para rutas
   *   autenticadas, así un usuario no consume la cuota de todos los que
   *   comparten IP (una oficina, un NAT). Sin credencial cae a la IP.
   */
  scope?: 'ip' | 'auth';
}

/**
 * Limita cuántas veces se puede llamar a una ruta (o a todas las de un
 * controlador) por ventana de tiempo. Lo aplica `RateLimitGuard`, registrado
 * globalmente: las rutas sin este decorador no se limitan.
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
