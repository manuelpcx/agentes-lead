import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Edición manual de la memoria del lead desde el panel. Los tres campos son
 * independientes: se puede reescribir el resumen, agregar o reemplazar un
 * hecho, y olvidar otro, en una sola llamada.
 */
export class UpdateLeadMemoryDto {
  /** Nuevo resumen. Cadena vacía lo borra. */
  @IsOptional()
  @IsString()
  @MaxLength(800)
  summary?: string;

  /** Clave del hecho a agregar o reemplazar (junto con `valor`). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clave?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  valor?: string;

  /** Clave del hecho a eliminar. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  olvidar?: string;
}
