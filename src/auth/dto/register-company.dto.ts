import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Registro autoservicio: crea empresa + usuario OWNER en un paso (Fase 7B). */
export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  rut!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
