import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_FUENTES } from '../lead-sources.service';

export class LeadSourceDto {
  @IsString()
  @MaxLength(60)
  nombre!: string;

  @IsString()
  @MaxLength(2000)
  url!: string;
}

/**
 * Fuentes de leads de la empresa. La forma de cada URL (https, host público)
 * la valida el servicio, que también resuelve el DNS.
 */
export class SaveLeadSourcesDto {
  @IsArray()
  @ArrayMaxSize(MAX_FUENTES)
  @ValidateNested({ each: true })
  @Type(() => LeadSourceDto)
  fuentes!: LeadSourceDto[];

  /** Si no viene (o viene vacío), se conserva el token guardado. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  parametroFecha?: string | null;
}
