import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

/** Rango visible del calendario (ISO 8601). */
export class AppointmentRangeQuery {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

/** Cita creada a mano desde el calendario del panel. */
export class CreateAppointmentDto {
  @IsUUID()
  leadId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Reagendar / reetiquetar / cambiar el estado de una cita. */
export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}
