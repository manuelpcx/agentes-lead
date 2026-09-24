import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Cambio de contraseña con sesión activa. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

/** Pedir un enlace de recuperación. Siempre responde igual, exista o no el email. */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

/** Fijar una contraseña nueva con el token del enlace de recuperación. */
export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
