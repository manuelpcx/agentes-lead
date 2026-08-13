import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** Simula un mensaje entrante de WhatsApp (dev). */
export class SimulateInboundDto {
  /** Teléfono del cliente en formato E.164 (ej. +56912345678). */
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone debe estar en formato E.164 (ej. +56912345678)',
  })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}
