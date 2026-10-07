import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AddEmailDomainDto, UpdateEmailSenderDto } from './email-panel.dto';

function errores<T extends object>(cls: new () => T, body: unknown): string[] {
  const dto = plainToInstance(cls, body);
  return validateSync(dto, { whitelist: true }).map((e) => e.property);
}

describe('AddEmailDomainDto', () => {
  it('acepta un subdominio y lo deja en minúsculas', () => {
    const dto = plainToInstance(AddEmailDomainDto, {
      domain: ' Notificaciones.Empresa.CL ',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.domain).toBe('notificaciones.empresa.cl');
  });

  it('rechaza lo que no es un dominio', () => {
    for (const domain of [
      'https://empresa.cl',
      'empresa.cl/correo',
      'empresa',
      'con espacio.cl',
      '-malo.cl',
    ]) {
      expect(errores(AddEmailDomainDto, { domain })).toEqual(['domain']);
    }
  });
});

describe('UpdateEmailSenderDto', () => {
  it('acepta un remitente completo', () => {
    expect(
      errores(UpdateEmailSenderDto, {
        fromName: 'Cobranzas del Sur',
        localPart: 'cobranza.norte',
        replyTo: 'equipo@sur.cl',
      }),
    ).toEqual([]);
  });

  it('un campo vacío es válido: lo borra', () => {
    expect(
      errores(UpdateEmailSenderDto, { localPart: '', replyTo: '' }),
    ).toEqual([]);
  });

  it('rechaza una dirección o un correo de respuestas inválidos', () => {
    expect(
      errores(UpdateEmailSenderDto, {
        localPart: 'con espacio',
        replyTo: 'no-es-correo',
      }).sort(),
    ).toEqual(['localPart', 'replyTo']);
  });
});
