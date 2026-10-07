import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Dominio o subdominio, sin protocolo ni ruta: `notificaciones.empresa.cl`. */
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Parte local de una dirección: `contacto`, `cobranza.norte`, `no-reply`. */
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Remitente de los correos de la empresa. Un campo vacío vuelve al valor por defecto. */
export class UpdateEmailSenderDto {
  /** Nombre que ve el destinatario ("Cobranzas del Sur"). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromName?: string;

  /** Lo que va antes de la @ en el dominio propio. */
  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @ValidateIf((o: UpdateEmailSenderDto) => o.localPart !== '')
  @Matches(LOCAL_PART_RE, {
    message:
      'La dirección solo puede tener letras, números, puntos, guiones y guiones bajos (ej. contacto).',
  })
  localPart?: string;

  /** Buzón real de la empresa: ahí llegan las respuestas. */
  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @ValidateIf((o: UpdateEmailSenderDto) => o.replyTo !== '')
  @IsEmail({}, { message: 'El correo para respuestas no es válido.' })
  replyTo?: string;
}

export class AddEmailDomainDto {
  @Transform(trimLower)
  @IsString()
  @Matches(DOMAIN_RE, {
    message:
      'Escribe solo el dominio, sin https:// ni barras (ej. notificaciones.tuempresa.cl).',
  })
  domain!: string;
}
