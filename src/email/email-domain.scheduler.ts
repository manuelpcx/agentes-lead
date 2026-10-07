import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ManagedEmailService } from './managed-email.service';

/**
 * Cada 10 min revisa en Resend los dominios de correo que siguen
 * verificándose. Así, apenas la empresa crea sus registros DNS, el correo
 * empieza a salir por su dominio sin que nadie tenga que abrir el panel.
 */
@Injectable()
export class EmailDomainScheduler {
  private readonly logger = new Logger(EmailDomainScheduler.name);

  constructor(private readonly managed: ManagedEmailService) {}

  @Cron('0 */10 * * * *')
  async tick(): Promise<void> {
    try {
      const revisados = await this.managed.refreshPendingDomains();
      if (revisados > 0) {
        this.logger.log(`Dominios de correo revisados en Resend: ${revisados}`);
      }
    } catch (e) {
      this.logger.warn(
        `Revisión de dominios de correo falló: ${(e as Error).message}`,
      );
    }
  }
}
