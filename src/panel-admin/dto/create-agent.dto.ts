import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AgentType } from '@prisma/client';

/** Alta de un agente desde el panel (Fase 8). */
export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(AgentType)
  type?: AgentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Canales que atiende ([] = cualquiera). Enrutamiento por canal. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  /** Estados de lead que maneja ([] = cualquiera). Enrutamiento por estado. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leadStates?: string[];

  /** Identificadores de herramientas habilitadas ([] = todas). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledTools?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /**
   * Config de seguimiento propia del agente (escalera, espaciado, tope de
   * intentos, retardo de primer contacto, plantillas por propósito). Lo no
   * definido cae a los defaults globales. Ver `agents/followup-config.ts`.
   */
  @IsOptional()
  @IsObject()
  followupConfig?: Record<string, unknown>;
}
