import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ServiceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Precio del servicio (opcional). Genera un StructuredFact de categoría PRECIO. */
  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
}

export class PolicyItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;
}

export class FaqItemDto {
  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  answer!: string;
}

export class ObjectionItemDto {
  @IsString()
  @IsNotEmpty()
  objection!: string;

  @IsString()
  @IsNotEmpty()
  response!: string;
}

/**
 * Cuestionario de onboarding. Se convierte en `StructuredFact` (datos
 * operativos: servicios, precios, horarios, políticas) + documentos indexados
 * (FAQs, objeciones). El agente consultará todo esto en fases siguientes.
 */
export class OnboardingDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services?: ServiceItemDto[];

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyItemDto)
  policies?: PolicyItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqItemDto)
  faqs?: FaqItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ObjectionItemDto)
  objections?: ObjectionItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  toneOfVoice?: string;
}
