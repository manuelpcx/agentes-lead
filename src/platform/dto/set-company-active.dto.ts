import { IsBoolean } from 'class-validator';

/** Activar o desactivar una empresa desde el mantenedor de la plataforma. */
export class SetCompanyActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
