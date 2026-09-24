import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Validación de URLs que el **servidor** va a llamar y que configuró un
 * cliente (webhook y consulta en vivo del CRM). Sin esto, una URL apuntada a
 * la red privada del PaaS, al metadata endpoint de la nube o al propio Redis
 * convierte al backend en un proxy hacia adentro (SSRF).
 *
 * Reglas: solo `https` (http únicamente fuera de producción), sin
 * credenciales en la URL, y el host —literal o resuelto por DNS— no puede
 * caer en un rango privado, de loopback, link-local o reservado.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface SafeUrlOptions {
  /** Permite `http://`. Por defecto solo fuera de producción. */
  allowHttp?: boolean;
  /** Resolutor DNS inyectable (para pruebas sin red). */
  lookup?: (host: string) => Promise<{ address: string }[]>;
}

/** Sufijos de host que nunca son destinos legítimos hacia afuera. */
const HOSTS_INTERNOS = ['localhost', '.localhost', '.local', '.internal'];

/** ¿La IPv4 (a.b.c.d) cae en un rango privado/reservado? */
function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) {
    return true; // no parseable: se trata como peligrosa
  }
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
    (a === 169 && b === 254) || // link-local + metadata de la nube
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 192 && b === 0) || // 192.0.0/24, 192.0.2/24 (doc)
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 (benchmarks)
    a >= 224 // multicast y reservado
  );
}

/** ¿La IPv6 cae en un rango privado/reservado? */
function isPrivateIPv6(raw: string): boolean {
  const ip = raw.toLowerCase();
  // IPv4 mapeada (::ffff:a.b.c.d): se juzga la IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }
  return (
    ip === '::' ||
    ip === '::1' ||
    ip.startsWith('fc') || // fc00::/7 (ULA)
    ip.startsWith('fd') ||
    /^fe[89ab]/.test(ip) || // fe80::/10 (link-local)
    /^fe[c-f]/.test(ip) || // fec0::/10 (site-local, obsoleto)
    ip.startsWith('ff') || // multicast
    ip.startsWith('::ffff:') // otras formas de mapeo
  );
}

/** true si la IP (v4 o v6) no debería recibir peticiones nuestras. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

function defaultLookup(host: string): Promise<{ address: string }[]> {
  return dnsLookup(host, { all: true });
}

/**
 * Valida la URL y devuelve el `URL` parseado. Lanza `UnsafeUrlError` con un
 * motivo legible si no se debe llamar.
 */
export async function assertSafeOutboundUrl(
  raw: string,
  options: SafeUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('no es una URL válida');
  }

  const allowHttp = options.allowHttp ?? process.env.NODE_ENV !== 'production';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError(
      allowHttp ? 'solo se permite http o https' : 'solo se permite https',
    );
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('no puede llevar usuario ni contraseña');
  }

  // `URL.hostname` deja los corchetes en IPv6 ([::1]); se quitan para juzgar.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new UnsafeUrlError('falta el host');
  }
  if (HOSTS_INTERNOS.some((s) => host === s || host.endsWith(s))) {
    throw new UnsafeUrlError(`el host "${host}" es interno`);
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UnsafeUrlError(`la IP ${host} es privada o reservada`);
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError(`no se pudo resolver el host "${host}"`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`el host "${host}" no resuelve a ninguna IP`);
  }
  const privada = addresses.find((a) => isPrivateAddress(a.address));
  if (privada) {
    throw new UnsafeUrlError(
      `el host "${host}" apunta a una IP privada (${privada.address})`,
    );
  }
  return url;
}
