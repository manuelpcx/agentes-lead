import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_PROVIDER,
  EmailMessage,
  EmailProvider,
} from './providers/email-provider.interface';

/** Fachada de envío de correo. */
@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_PROVIDER)
    private readonly provider: EmailProvider,
  ) {}

  send(message: EmailMessage): Promise<void> {
    return this.provider.send(message);
  }
}
