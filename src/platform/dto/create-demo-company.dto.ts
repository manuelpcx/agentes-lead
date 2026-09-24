import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Alta de una cuenta de demostración desde el mantenedor de la plataforma. */
export class CreateDemoCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

  /** Opcional: una demo no siempre tiene un RUT real. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rut?: string;

  @IsEmail()
  email!: string;

  /** Si no se envía, se genera una y se muestra una sola vez. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
