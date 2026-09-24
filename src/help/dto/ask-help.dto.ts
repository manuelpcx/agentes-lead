import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Un turno de la conversación con el asistente de ayuda. */
export class HelpMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  text!: string;
}

/** Pregunta al asistente de ayuda: historial completo, el último es la pregunta. */
export class AskHelpDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => HelpMessageDto)
  messages!: HelpMessageDto[];
}
