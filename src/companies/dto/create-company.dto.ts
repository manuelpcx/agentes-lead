import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Cuerpo para registrar una empresa (tenant raíz). */
export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  /** RUT chileno (validación de formato se refina más adelante). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  rut!: string;

  /** Zona horaria IANA; por defecto America/Santiago. */
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
