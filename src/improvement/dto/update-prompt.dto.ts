import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Edición manual del prompt de un agente, hecha por el dueño desde el panel. */
export class UpdatePromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;
}
