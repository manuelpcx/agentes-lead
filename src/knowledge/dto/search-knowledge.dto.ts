import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';

/** Consulta de búsqueda semántica de prueba. */
export class SearchKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  /** Cantidad máxima de fragmentos a devolver (1-20). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  /** Similitud mínima (0-1) para considerar un fragmento relevante. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;
}
