import {
  ResendApiError,
  ResendDomainsClient,
  recordFqdn,
} from './resend-domains.client';

function res(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mockFetch(...responses: ReturnType<typeof res>[]): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

describe('ResendDomainsClient', () => {
  const client = new ResendDomainsClient('re_key');

  it('da de alta el dominio en la región pedida, con la API key de la plataforma', async () => {
    const fetchMock = mockFetch(
      res(200, {
        id: 'd1',
        name: 'notificaciones.x.cl',
        status: 'not_started',
        records: [],
      }),
    );

    const out = await client.create('notificaciones.x.cl', 'sa-east-1');

    expect(out.id).toBe('d1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/domains');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      name: 'notificaciones.x.cl',
      region: 'sa-east-1',
    });
  });

  it('verificar llama al endpoint del dominio', async () => {
    const fetchMock = mockFetch(res(200, { object: 'domain', id: 'd1' }));

    await client.verify('d1');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.resend.com/domains/d1/verify',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('quitar un dominio que ya no existe en Resend no es un error', async () => {
    mockFetch(res(404, { message: 'Domain not found' }));

    await expect(client.remove('d1')).resolves.toBeUndefined();
  });

  it('una API key sin permisos de dominios lo dice claro', async () => {
    mockFetch(res(403, {}));

    await expect(client.create('x.cl', 'sa-east-1')).rejects.toThrow(
      /Full access/,
    );
  });

  it('pasa el mensaje de Resend (p. ej. dominio ya registrado)', async () => {
    mockFetch(res(422, { message: 'Domain already exists' }));

    const error = await client
      .create('x.cl', 'sa-east-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResendApiError);
    expect((error as ResendApiError).status).toBe(422);
    expect((error as Error).message).toContain('Domain already exists');
  });
});

describe('recordFqdn', () => {
  it('con el dominio principal, junta el nombre y el dominio', () => {
    expect(recordFqdn('send', 'cliente.cl')).toBe('send.cliente.cl');
    expect(recordFqdn('resend._domainkey', 'cliente.cl')).toBe(
      'resend._domainkey.cliente.cl',
    );
  });

  it('con un subdominio, no repite la parte que Resend ya puso en el nombre', () => {
    expect(
      recordFqdn(
        'resend._domainkey.notificaciones',
        'notificaciones.cliente.cl',
      ),
    ).toBe('resend._domainkey.notificaciones.cliente.cl');
    expect(recordFqdn('send.notificaciones', 'notificaciones.cliente.cl')).toBe(
      'send.notificaciones.cliente.cl',
    );
  });
});
