import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Respuesta manual de un operador desde el panel. */
export class ReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}
