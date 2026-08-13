import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { KnowledgeSourceType } from '@prisma/client';

/**
 * Edición de un documento. Si viene `content`, se re-trocea y re-indexa, y se
 * incrementa la versión.
 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsEnum(KnowledgeSourceType)
  sourceType?: KnowledgeSourceType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;
}
