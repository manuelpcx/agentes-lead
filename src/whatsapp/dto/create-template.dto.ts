import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Categorías de plantilla de WhatsApp (Meta). */
export enum TemplateCategory {
  MARKETING = 'MARKETING',
  UTILITY = 'UTILITY',
  AUTHENTICATION = 'AUTHENTICATION',
}

/**
 * Crea una plantilla de WhatsApp y la envía a aprobación de Meta (vía YCloud).
 * El cuerpo usa variables numeradas {{1}}, {{2}}, … y cada una necesita un
 * ejemplo (Meta lo exige para revisar la plantilla).
 */
export class CreateWhatsappTemplateDto {
  /** Nombre único: minúsculas, números y guion bajo. */
  @IsString()
  @Matches(/^[a-z0-9_]{1,512}$/, {
    message: 'El nombre solo admite minúsculas, números y guion bajo.',
  })
  name!: string;

  /** Código de idioma (p. ej. "es_CL", "es"). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  language!: string;

  @IsEnum(TemplateCategory)
  category!: TemplateCategory;

  /** Cuerpo del mensaje. Usa {{1}}, {{2}}, … para variables. Máx. 1024. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  body!: string;

  /** Un ejemplo por cada variable del cuerpo, en orden. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  examples?: string[];

  /** Pie opcional (sin variables). Máx. 60. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;
}
