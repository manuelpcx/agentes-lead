import { BadRequestException } from '@nestjs/common';
import { extractText } from './extract-text';

describe('extractText', () => {
  it('decodifica .txt/.md/.csv/.json como UTF-8', () => {
    expect(
      extractText({ originalname: 'faq.txt', buffer: Buffer.from('hola') }),
    ).toBe('hola');
    expect(
      extractText({
        originalname: 'notas.MD',
        buffer: Buffer.from('# Título'),
      }),
    ).toBe('# Título');
  });

  it('rechaza formatos no soportados con un mensaje claro', () => {
    expect(() =>
      extractText({ originalname: 'manual.pdf', buffer: Buffer.from('x') }),
    ).toThrow(BadRequestException);
    expect(() =>
      extractText({ originalname: 'sin-extension', buffer: Buffer.from('x') }),
    ).toThrow(BadRequestException);
  });

  it('rechaza un archivo vacío', () => {
    expect(() =>
      extractText({ originalname: 'vacio.txt', buffer: Buffer.from('   ') }),
    ).toThrow(BadRequestException);
  });
});
