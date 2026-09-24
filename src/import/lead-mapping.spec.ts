import { LeadStatus } from '@prisma/client';
import {
  mapStatus,
  normalizeEmail,
  normalizePhone,
  prefixFromTimezone,
  suggestMapping,
} from './lead-mapping';

describe('suggestMapping', () => {
  it('reconoce cabeceras en español con tildes y mayúsculas', () => {
    expect(
      suggestMapping(['Nombre', 'Teléfono', 'Correo electrónico', 'Origen']),
    ).toEqual({
      Nombre: 'name',
      Teléfono: 'phone',
      'Correo electrónico': 'email',
      Origen: 'source',
    });
  });

  it('reconoce las cabeceras típicas de un export de HubSpot', () => {
    expect(
      suggestMapping([
        'Record ID',
        'First Name',
        'Phone Number',
        'Email',
        'Lifecycle Stage',
        'Original Source',
      ]),
    ).toEqual({
      'Record ID': 'externalId',
      'First Name': 'name',
      'Phone Number': 'phone',
      Email: 'email',
      'Lifecycle Stage': 'status',
      'Original Source': 'source',
    });
  });

  it('deja en null lo que no reconoce (no se pierde: va a la metadata)', () => {
    const mapping = suggestMapping(['Nombre', 'RUT', 'Comuna']);
    expect(mapping.RUT).toBeNull();
    expect(mapping.Comuna).toBeNull();
  });

  it('no asigna dos columnas al mismo campo', () => {
    const mapping = suggestMapping(['Teléfono', 'Celular']);
    expect(mapping['Teléfono']).toBe('phone');
    expect(mapping['Celular']).toBeNull();
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+56 9 1234 5678', '+56', '+56912345678'],
    ['(+56) 9-1234.5678', '+56', '+56912345678'],
    ['0056912345678', '+56', '+56912345678'],
    ['56912345678', '+56', '+56912345678'],
    ['912345678', '+56', '+56912345678'],
    ['0912345678', '+56', '+56912345678'],
    ['55 1234 5678', '+52', '+525512345678'],
    ['+1 (415) 555-0132', '+56', '+14155550132'],
  ])('normaliza %s con prefijo %s', (raw, prefix, expected) => {
    expect(normalizePhone(raw, prefix)).toBe(expected);
  });

  it.each([
    ['', '+56'],
    ['   ', '+56'],
    ['no tiene', '+56'],
    ['s/n', '+56'],
    ['1234', '+56'],
    ['+0123456789', '+56'],
  ])('devuelve null para %s en vez de inventar un número', (raw, prefix) => {
    expect(normalizePhone(raw, prefix)).toBeNull();
  });

  it('no le pega el prefijo por defecto a un número que ya trae otro país', () => {
    expect(normalizePhone('+525512345678', '+56')).toBe('+525512345678');
  });
});

describe('normalizeEmail', () => {
  it('pasa a minúsculas y recorta espacios', () => {
    expect(normalizeEmail('  Ana@Test.CL ')).toBe('ana@test.cl');
  });

  it('se queda con el primero cuando vienen varios en la celda', () => {
    expect(normalizeEmail('ana@test.cl; otra@test.cl')).toBe('ana@test.cl');
  });

  it.each(['', 'ana', 'ana@', '@test.cl', 'ana@test'])('rechaza %s', (raw) => {
    expect(normalizeEmail(raw)).toBeNull();
  });
});

describe('mapStatus', () => {
  it.each([
    ['Nuevo', LeadStatus.NUEVO],
    ['Contacted', LeadStatus.CONTACTADO],
    ['En conversación', LeadStatus.EN_CONVERSACION],
    ['Meeting Scheduled', LeadStatus.AGENDADO],
    ['Closed Won', LeadStatus.CERRADO_GANADO],
    ['No interesado', LeadStatus.CERRADO_PERDIDO],
  ])('traduce la etapa %s', (raw, expected) => {
    expect(mapStatus(raw)).toBe(expected);
  });

  it('devuelve null ante una etapa que no conoce', () => {
    expect(mapStatus('Etapa 3 del pipeline viejo')).toBeNull();
  });
});

describe('prefixFromTimezone', () => {
  it('sugiere +52 para una empresa en México', () => {
    expect(prefixFromTimezone('America/Mexico_City')).toBe('+52');
  });

  it('cae a Chile cuando la zona no está en la tabla', () => {
    expect(prefixFromTimezone('Antarctica/Troll')).toBe('+56');
    expect(prefixFromTimezone(null)).toBe('+56');
  });
});
