import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** Credenciales de login del panel. */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
