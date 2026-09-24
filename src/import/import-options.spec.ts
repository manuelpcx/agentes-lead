import { BadRequestException } from '@nestjs/common';
import { parseImportOptions } from './import-options';

const BASE = {
  mapping: JSON.stringify({ Nombre: 'name', Teléfono: 'phone' }),
  phonePrefix: '+52',
  duplicates: 'update',
};

describe('parseImportOptions', () => {
  it('tipa el mapeo y descarta las columnas sin campo asignado', () => {
    const options = parseImportOptions(
      {
        ...BASE,
        mapping: JSON.stringify({
          Nombre: 'name',
          Teléfono: 'phone',
          Comuna: null,
          Región: '',
        }),
      },
      'contactos.csv',
    );
    expect(options.mapping).toEqual({ Nombre: 'name', Teléfono: 'phone' });
    expect(options.phonePrefix).toBe('+52');
    expect(options.fileName).toBe('contactos.csv');
  });

  it('el contacto automático es opt-in: sin el campo queda apagado', () => {
    expect(parseImportOptions(BASE).scheduleFirstContact).toBe(false);
    expect(
      parseImportOptions({ ...BASE, scheduleFirstContact: 'false' })
        .scheduleFirstContact,
    ).toBe(false);
    expect(
      parseImportOptions({ ...BASE, scheduleFirstContact: 'true' })
        .scheduleFirstContact,
    ).toBe(true);
  });

  it('rechaza un campo que no existe en la ficha', () => {
    expect(() =>
      parseImportOptions({
        ...BASE,
        mapping: JSON.stringify({ Nombre: 'nombre' }),
      }),
    ).toThrow(BadRequestException);
  });

  it('rechaza dos columnas apuntando al mismo campo', () => {
    expect(() =>
      parseImportOptions({
        ...BASE,
        mapping: JSON.stringify({ Teléfono: 'phone', Celular: 'phone' }),
      }),
    ).toThrow(BadRequestException);
  });

  it('rechaza un prefijo que no es código de país', () => {
    expect(() => parseImportOptions({ ...BASE, phonePrefix: '56' })).toThrow(
      BadRequestException,
    );
  });

  it('rechaza un modo de duplicados desconocido', () => {
    expect(() => parseImportOptions({ ...BASE, duplicates: 'borrar' })).toThrow(
      BadRequestException,
    );
  });

  it('rechaza un mapeo que no es JSON', () => {
    expect(() => parseImportOptions({ ...BASE, mapping: 'name' })).toThrow(
      BadRequestException,
    );
  });
});
