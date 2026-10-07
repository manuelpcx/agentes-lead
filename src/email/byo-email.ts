import type { ResolvedCredential } from '../integrations/credentials.service';
import type { EmailProvider } from './providers/email-provider.interface';
import { ResendEmailProvider } from './providers/resend.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';

/**
 * Proveedor de la cuenta PROPIA de la empresa (Integraciones → Correo →
 * avanzado: su Resend o su SMTP), o null si no la conectó completa. Si la
 * conectó, manda sobre el correo gestionado: es una elección explícita.
 */
export function byoEmailProvider(
  c: ResolvedCredential | null,
): EmailProvider | null {
  if (!c?.isActive) {
    return null;
  }
  if (c.provider === 'resend' && c.secret && c.config.from) {
    return new ResendEmailProvider(c.secret, String(c.config.from));
  }
  if (c.provider === 'smtp' && c.config.host && c.config.from) {
    return new SmtpEmailProvider({
      host: String(c.config.host),
      port: Number(c.config.port ?? 587),
      secure: c.config.secure === true || c.config.secure === 'true',
      user: c.config.user ? String(c.config.user) : undefined,
      pass: c.secret,
      from: String(c.config.from),
    });
  }
  return null;
}
