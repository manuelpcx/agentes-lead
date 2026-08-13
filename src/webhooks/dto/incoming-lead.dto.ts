import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Canales de contacto preferidos válidos (subconjunto de `Channel`). */
export const PREFERRED_CHANNELS = ['whatsapp', 'email', 'call'] as const;
export type PreferredChannel = (typeof PREFERRED_CHANNELS)[number];

/**
 * Cuerpo del webhook `POST /webhooks/lead`. Estricto: la empresa NO viaja en el
 * body (se resuelve por autenticación). `externalId` da idempotencia.
 */
export class IncomingLeadDto {
  /** Identificador del lead en el sistema de origen. Único por empresa. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  /** Teléfono en formato E.164 (ej. +56912345678). */
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone debe estar en formato E.164 (ej. +56912345678)',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaign?: string;

  @IsOptional()
  @IsIn(PREFERRED_CHANNELS)
  preferredChannel?: PreferredChannel;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** Metadatos libres del origen (utm, formulario, etc.). */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
