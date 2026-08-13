/**
 * true si la URL de Redis apunta a la máquina local (dev). Se usa para decidir
 * el `family` de ioredis: en Railway la red interna es IPv6 y hay que permitir
 * IPv6 (`family: 0`); en localhost se deja el default para no romper el dev.
 */
export function isLocalRedis(url: string): boolean {
  return /(?:localhost|127\.0\.0\.1|\[::1\])/.test(url);
}
