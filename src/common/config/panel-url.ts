import { ConfigService } from '@nestjs/config';
import type { EnvVars } from './env.validation';

/**
 * URL pública del panel, sin barra final, para los enlaces de los correos
 * (recuperar contraseña, alertas). `PANEL_URL`; si falta, el primer origen de
 * `CORS_ORIGIN`; si tampoco, el Vite local.
 */
export function resolvePanelUrl(config: ConfigService<EnvVars, true>): string {
  return (
    config.get('PANEL_URL', { infer: true }) ??
    config.get('CORS_ORIGIN', { infer: true })?.split(',')[0]?.trim() ??
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}
