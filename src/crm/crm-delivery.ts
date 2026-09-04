import { Logger } from '@nestjs/common';
import { signHmacSha256Hex } from '../common/webhook-signature';
import { CrmEventJob } from './crm-event.types';

const logger = new Logger('CrmDelivery');

/** Resultado de intentar entregar un evento al webhook del CRM. */
export interface CrmDeliveryResult {
  ok: boolean;
  status?: number;
  message: string;
}

/**
 * Hace el POST firmado al webhook del CRM del cliente. Reutilizada por el
 * worker de entrega (`CrmEventsProcessor`) y por "Probar conexión" (que manda
 * un evento `test.ping` real), para no duplicar la lógica de firma/envío.
 *
 * El cliente verifica la firma igual que nosotros exigimos la suya en
 * Retell/YCloud: `X-Signature` = HMAC-SHA256(secreto, cuerpo crudo) en hex.
 */
export async function deliverCrmEvent(
  url: string,
  secret: string,
  job: CrmEventJob,
): Promise<CrmDeliveryResult> {
  const payload = {
    event: job.event,
    companyId: job.companyId,
    leadId: job.leadId,
    externalId: job.externalId,
    occurredAt: job.occurredAt,
    data: job.data,
  };
  const body = JSON.stringify(payload);
  const signature = signHmacSha256Hex(secret, body);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Company-Id': job.companyId,
      },
      body,
    });
  } catch (e) {
    const message = `No se pudo conectar con ${url}: ${(e as Error).message}`;
    logger.warn(message);
    return { ok: false, message };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const message = `El CRM respondió ${res.status}: ${detail.slice(0, 200)}`;
    logger.warn(message);
    return { ok: false, status: res.status, message };
  }
  return { ok: true, status: res.status, message: 'Entregado correctamente.' };
}
