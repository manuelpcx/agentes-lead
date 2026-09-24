import { decodeCsvBuffer, detectDelimiter, parseCsv } from './csv';

describe('parseCsv', () => {
  it('lee un CSV simple separado por comas', () => {
    const result = parseCsv('nombre,email\nAna,ana@test.cl\nBruno,b@test.cl\n');
    expect(result.headers).toEqual(['nombre', 'email']);
    expect(result.rows).toEqual([
      ['Ana', 'ana@test.cl'],
      ['Bruno', 'b@test.cl'],
    ]);
    expect(result.delimiter).toBe(',');
  });

  it('detecta el punto y coma que usa Excel en español', () => {
    const csv = 'nombre;telefono;correo\nAna;+56911111111;ana@test.cl';
    expect(detectDelimiter(csv)).toBe(';');
    expect(parseCsv(csv).rows[0]).toEqual([
      'Ana',
      '+56911111111',
      'ana@test.cl',
    ]);
  });

  it('respeta comas, comillas y saltos de línea dentro de un campo entrecomillado', () => {
    const csv = 'nombre,nota\n"Pérez, Ana","dijo ""sí""\nllamar mañana"';
    const { rows } = parseCsv(csv);
    expect(rows).toEqual([['Pérez, Ana', 'dijo "sí"\nllamar mañana']]);
  });

  it('se come el BOM de Excel para no arruinar la primera cabecera', () => {
    const { headers } = parseCsv('﻿nombre,email\nAna,a@test.cl');
    expect(headers[0]).toBe('nombre');
  });

  it('acepta CRLF y descarta las líneas en blanco del final', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n\r\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('alinea filas cortas y largas al largo de la cabecera', () => {
    const { rows } = parseCsv('a,b,c\n1,2\n1,2,3,4');
    expect(rows).toEqual([
      ['1', '2', ''],
      ['1', '2', '3'],
    ]);
  });

  it('no trata como comilla una que aparece a mitad de campo', () => {
    // Si abriera comillas acá, se tragaría el resto del archivo.
    const { rows } = parseCsv('nombre,alias\nAna,la "jefa"\nBruno,x');
    expect(rows).toEqual([
      ['Ana', 'la "jefa"'],
      ['Bruno', 'x'],
    ]);
  });

  it('corta en maxRows y deja contadas las filas que sobran', () => {
    const csv = ['a', '1', '2', '3', '4'].join('\n');
    const result = parseCsv(csv, { maxRows: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(2);
  });

  it('devuelve vacío sin reventar cuando el archivo no trae nada', () => {
    expect(parseCsv('')).toEqual({
      headers: [],
      rows: [],
      delimiter: ',',
      truncated: 0,
    });
  });
});

describe('decodeCsvBuffer', () => {
  it('lee UTF-8 tal cual', () => {
    expect(decodeCsvBuffer(Buffer.from('José,Muñoz', 'utf8'))).toBe(
      'José,Muñoz',
    );
  });

  it('reintenta en Latin-1 cuando el UTF-8 sale con caracteres rotos', () => {
    // Lo que produce Excel en Windows al exportar "José" como CSV.
    expect(decodeCsvBuffer(Buffer.from('José', 'latin1'))).toBe('José');
  });
});
