import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FactCategory } from '@prisma/client';

/**
 * Alta/actualización de un hecho estructurado (precio, horario, política...).
 * Es la fuente de verdad para datos operativos: el agente los consulta, nunca
 * los recita de memoria.
 */
export class UpsertFactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;

  @IsEnum(FactCategory)
  category!: FactCategory;

  /** Valor estructurado (ej. { monto: 25000, moneda: "CLP", unidad: "sesión" }). */
  @IsObject()
  value!: Record<string, unknown>;

  /** Inicio de vigencia (ISO 8601). Por defecto, ahora. */
  @IsOptional()
  @IsString()
  validFrom?: string;

  /** Fin de vigencia (ISO 8601). Null/omitido = sin expiración. */
  @IsOptional()
  @IsString()
  validUntil?: string;
}
