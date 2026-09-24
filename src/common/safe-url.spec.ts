import {
  UnsafeUrlError,
  assertSafeOutboundUrl,
  isPrivateAddress,
} from './safe-url';

/** DNS falso: cada host resuelve a lo que diga la tabla. */
function lookupFrom(table: Record<string, string[]>) {
  return async (host: string) => {
    const ips = table[host];
    if (!ips) throw new Error('ENOTFOUND');
    return ips.map((address) => ({ address }));
  };
}

const PUBLIC = lookupFrom({ 'crm.ejemplo.cl': ['93.184.216.34'] });

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
  ])('trata %s como privada/reservada', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])(
    'trata %s como pública',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it('trata como peligroso lo que no es una IP', () => {
    expect(isPrivateAddress('no-es-ip')).toBe(true);
  });
});

describe('assertSafeOutboundUrl', () => {
  it('acepta una https pública que resuelve a una IP pública', async () => {
    const url = await assertSafeOutboundUrl('https://crm.ejemplo.cl/webhook', {
      lookup: PUBLIC,
    });
    expect(url.hostname).toBe('crm.ejemplo.cl');
  });

  it('rechaza http en producción y lo acepta fuera de ella', async () => {
    await expect(
      assertSafeOutboundUrl('http://crm.ejemplo.cl/x', {
        allowHttp: false,
        lookup: PUBLIC,
      }),
    ).rejects.toThrow(UnsafeUrlError);
    await expect(
      assertSafeOutboundUrl('http://crm.ejemplo.cl/x', {
        allowHttp: true,
        lookup: PUBLIC,
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ['ftp://crm.ejemplo.cl/x', 'otro protocolo'],
    ['no es url', 'texto suelto'],
    ['https://user:pass@crm.ejemplo.cl/x', 'credenciales en la URL'],
    ['https://localhost:3000/x', 'localhost'],
    ['https://api.railway.internal/x', 'host interno del PaaS'],
    ['https://mi-pc.local/x', 'mDNS'],
    ['https://127.0.0.1/x', 'loopback literal'],
    ['https://169.254.169.254/latest/meta-data', 'metadata de la nube'],
    ['https://[::1]/x', 'loopback IPv6'],
    ['https://10.0.0.5:6379/', 'Redis en red privada'],
  ])('rechaza %s (%s)', async (raw) => {
    await expect(
      assertSafeOutboundUrl(raw, { allowHttp: true, lookup: PUBLIC }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rechaza un dominio público que resuelve a una IP privada (DNS rebinding / túnel)', async () => {
    const lookup = lookupFrom({
      'malo.ejemplo.cl': ['203.0.113.5', '10.0.0.9'],
    });
    await expect(
      assertSafeOutboundUrl('https://malo.ejemplo.cl/x', { lookup }),
    ).rejects.toThrow(/IP privada/);
  });

  it('rechaza un host que no resuelve', async () => {
    await expect(
      assertSafeOutboundUrl('https://no-existe.ejemplo.cl/x', {
        lookup: PUBLIC,
      }),
    ).rejects.toThrow(/no se pudo resolver/);
  });

  it('el mensaje de error es legible para mostrarlo en el panel', async () => {
    await expect(
      assertSafeOutboundUrl('https://192.168.0.10/hook', { lookup: PUBLIC }),
    ).rejects.toThrow('la IP 192.168.0.10 es privada o reservada');
  });
});
