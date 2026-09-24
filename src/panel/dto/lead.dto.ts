import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Channel, LeadQualification, LeadStatus } from '@prisma/client';

const E164 = /^\+[1-9]\d{7,14}$/;

/** Filtros de la bandeja: estado del embudo + búsqueda de texto libre. */
export class ListLeadsQuery {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  /** Busca en nombre, teléfono, email e identificador de origen. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/** Alta manual de un lead desde el panel (sin pasar por el webhook). */
export class CreateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Matches(E164, {
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
  @IsEnum(Channel)
  preferredChannel?: Channel;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** Edición manual de la ficha del lead. Todos los campos son opcionales. */
export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Matches(E164, {
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
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadQualification)
  qualification?: LeadQualification;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  qualificationReason?: string;

  @IsOptional()
  @IsEnum(Channel)
  preferredChannel?: Channel;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** ISO 8601. Cadena vacía o null cancela la próxima acción. */
  @IsOptional()
  @IsISO8601()
  nextActionAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nextActionType?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
