import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PanelRole } from '@prisma/client';

/** Alta de un usuario del panel con su rol en la empresa autenticada. */
export class CreateUserDto {
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

  @IsEnum(PanelRole)
  role!: PanelRole;
}
