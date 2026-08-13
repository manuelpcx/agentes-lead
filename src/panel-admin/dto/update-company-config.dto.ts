import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Configuración editable de la empresa desde el panel (Fase 7B). */
export class UpdateCompanyConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  channelsConfig?: Record<string, unknown>;
}
