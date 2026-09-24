import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Nota interna del equipo sobre un lead. */
export class CreateLeadNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}
