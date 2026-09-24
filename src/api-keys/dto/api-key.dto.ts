import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PanelRole } from '@prisma/client';

/** Alta de una llave de API desde el panel. */
export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** Permisos de la llave. Si no viene, SOLO_LECTURA. */
  @IsOptional()
  @IsEnum(PanelRole)
  role?: PanelRole;

  /** Fecha de caducidad opcional (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
