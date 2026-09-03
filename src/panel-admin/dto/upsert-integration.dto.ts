import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Guarda las credenciales de un canal para la empresa. `secret` es la API
 * key/token (write-only: si no viene, se conserva el actual). `config` son los
 * datos NO secretos del proveedor (from, wabaId, agentId, etc.).
 */
export class UpsertIntegrationDto {
  /** Proveedor: ycloud | meta | resend | smtp | retell | vapi. */
  @IsString()
  provider!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /** API key/token. Si se omite, no se cambia el secreto guardado. */
  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
