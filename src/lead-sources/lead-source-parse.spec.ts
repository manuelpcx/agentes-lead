import {
  MAX_REGISTROS,
  aTabla,
  extraerRegistros,
  mapeoAutomatico,
  urlDeApi,
} from './lead-source-parse';

describe('extraerRegistros', () => {
  it('acepta un arreglo directo', () => {
    expect(extraerRegistros([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });

  it('busca la lista en las envolturas habituales', () => {
    for (const clave of ['data', 'leads', 'items', 'results', 'records']) {
      expect(extraerRegistros({ [clave]: [{ a: 1 }], total: 1 })).toEqual([
        { a: 1 },
      ]);
    }
  });

  it('si no reconoce la envoltura, toma el primer arreglo de objetos', () => {
    expect(
      extraerRegistros({ meta: { page: 1 }, deudores: [{ rut: '1-9' }] }),
    ).toEqual([{ rut: '1-9' }]);
  });

  it('entra un nivel más (data.items)', () => {
    expect(extraerRegistros({ data: { items: [{ a: 1 }] } })).toEqual([
      { a: 1 },
    ]);
  });

  it('un objeto suelto con pinta de lead cuenta como un registro', () => {
    expect(
      extraerRegistros({ nombre: 'Ana', telefono: '+56911111111' }),
    ).toEqual([{ nombre: 'Ana', telefono: '+56911111111' }]);
  });

  it('null si no hay nada utilizable', () => {
    expect(extraerRegistros('hola')).toBeNull();
    expect(extraerRegistros({ ok: true })).toBeNull();
    expect(extraerRegistros([1, 2, 3])).toBeNull();
  });

  it('una lista vacía es "nada nuevo", no un error', () => {
    expect(extraerRegistros({ data: [] })).toEqual([]);
  });
});

describe('aTabla', () => {
  it('une las claves de todos los registros y aplana objetos anidados', () => {
    const t = aTabla([
      { id: 7, nombre: 'Ana', cliente: { telefono: '+56911111111' } },
      { id: 8, email: 'b@x.cl', deuda: { monto: 150000, cuotas: [1, 2] } },
    ]);

    expect(t.headers).toEqual([
      'id',
      'nombre',
      'cliente.telefono',
      'email',
      'deuda.monto',
      'deuda.cuotas',
    ]);
    expect(t.rows[0]).toEqual(['7', 'Ana', '+56911111111', '', '', '']);
    expect(t.rows[1]).toEqual(['8', '', '', 'b@x.cl', '150000', '[1,2]']);
    expect(t.firstDataRow).toBe(1);
  });

  it('null, undefined y booleanos se llevan a texto con sentido', () => {
    const t = aTabla([{ a: null, b: undefined, c: true }]);
    expect(t.rows[0]).toEqual(['', '', 'true']);
  });

  it(`corta en ${MAX_REGISTROS} registros y lo informa`, () => {
    const muchos = Array.from({ length: MAX_REGISTROS + 3 }, (_, i) => ({
      id: i,
    }));
    const t = aTabla(muchos);
    expect(t.rows).toHaveLength(MAX_REGISTROS);
    expect(t.truncated).toBe(3);
  });
});

describe('mapeoAutomatico', () => {
  it('reconoce camelCase, snake_case y campos anidados por su última parte', () => {
    expect(
      mapeoAutomatico([
        'leadId',
        'fullName',
        'contacto.phoneNumber',
        'email_address',
        'deuda.monto',
      ]),
    ).toEqual({
      leadId: 'externalId',
      fullName: 'name',
      'contacto.phoneNumber': 'phone',
      email_address: 'email',
    });
  });

  it('reconoce los nombres en español habituales', () => {
    expect(mapeoAutomatico(['rut', 'nombre', 'celular', 'correo'])).toEqual({
      rut: 'externalId',
      nombre: 'name',
      celular: 'phone',
      correo: 'email',
    });
  });

  it('con un id propio, el RUT queda en la metadata', () => {
    expect(mapeoAutomatico(['id', 'rut', 'celular'])).toEqual({
      id: 'externalId',
      celular: 'phone',
    });
  });

  it('lo que no reconoce no entra al mapeo (va a la metadata)', () => {
    expect(mapeoAutomatico(['folio', 'monto'])).toEqual({});
  });
});

describe('urlDeApi', () => {
  it('convierte la URL del navegador de Airtable en la de su API, con la vista', () => {
    expect(
      urlDeApi(
        'https://airtable.com/appAbC123/tblXyZ456/viwQwE789?blocks=hide',
      ),
    ).toBe('https://api.airtable.com/v0/appAbC123/tblXyZ456?view=viwQwE789');
  });

  it('sin vista, solo la tabla', () => {
    expect(urlDeApi('https://airtable.com/appAbC123/tblXyZ456')).toBe(
      'https://api.airtable.com/v0/appAbC123/tblXyZ456',
    );
  });

  it('deja tal cual una URL de API o de otro sistema', () => {
    for (const url of [
      'https://api.airtable.com/v0/appAbC123/tblXyZ456?view=viwQwE789',
      'https://api.cliente.cl/leads',
    ]) {
      expect(urlDeApi(url)).toBe(url);
    }
  });
});
