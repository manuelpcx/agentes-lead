import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { KnowledgeSourceType } from '@prisma/client';

/** Alta de un documento de conocimiento (texto/markdown). */
export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsEnum(KnowledgeSourceType)
  sourceType?: KnowledgeSourceType;

  /** Contenido en texto plano o markdown. Se trocea e indexa. */
  @IsString()
  @IsNotEmpty()
  content!: string;
}
