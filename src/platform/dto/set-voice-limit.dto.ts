import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/**
 * Tope mensual de minutos de voz gestionada de una empresa. `null` vuelve al
 * valor por defecto de la plataforma (VOICE_MONTHLY_MINUTES_DEFAULT); 0 la deja
 * sin llamadas.
 */
export class SetVoiceLimitDto {
  @ValidateIf((o: SetVoiceLimitDto) => o.minutes !== null)
  @IsInt()
  @Min(0)
  @Max(100000)
  minutes!: number | null;
}
