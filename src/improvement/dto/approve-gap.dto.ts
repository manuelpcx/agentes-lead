import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Aprobación de un vacío de conocimiento (respuesta opcional a editar). */
export class ApproveGapDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answer?: string;
}
