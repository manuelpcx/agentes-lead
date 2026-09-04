import { Logger } from '@nestjs/common';
import { signHmacSha256Hex } from '../common/webhook-signature';

const logger = new Logger('CrmQuery');
/** Recorte del dato devuelto por el CRM antes de meterlo al contexto del LLM. */
const MAX_RESPONSE_CHARS = 4000;

/** Datos de una consulta en vivo al CRM del cliente. */
export interface CrmQueryRequest {
  companyId: string;
  leadId: string;
  externalId: string | null;
  query: string;
}

/** Resultado de la consulta. */
export interface CrmQueryResult {
  ok: boolean;
  data?: string;
  message: string;
}

/**
 * Consulta EN VIVO el CRM del cliente durante un turno del agente (a mitad de
 * conversación): POST firmado, síncrono, con timeout corto — a diferencia de
 * `deliverCrmEvent` (fire-and-forget vía cola), esto BLOQUEA el turno hasta
 * que el CRM responde o se agota el tiempo. Usa una URL separada de la de
 * eventos (`config.queryUrl`): el cliente puede querer eventos sin exponer
 * una consulta en vivo, o viceversa.
 */
export async function queryCrm(
  url: string,
  secret: string,
  req: CrmQueryRequest,
  timeoutMs = 8000,
): Promise<CrmQueryResult> {
  const payload = {
    event: 'crm.query' as const,
    companyId: req.companyId,
    leadId: req.leadId,
    externalId: req.externalId,
    query: req.query,
  };
  const body = JSON.stringify(payload);
  const signature = signHmacSha256Hex(secret, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Company-Id': req.companyId,
      },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError';
    const message = timedOut
      ? `El CRM no respondió en ${timeoutMs / 1000}s.`
      : `No se pudo conectar con ${url}: ${(e as Error).message}`;
    logger.warn(message);
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const message = `El CRM respondió ${res.status}: ${text.slice(0, 200)}`;
    logger.warn(message);
    return { ok: false, message };
  }

  return {
    ok: true,
    data: extractData(text).slice(0, MAX_RESPONSE_CHARS),
    message: 'Consulta respondida.',
  };
}

/**
 * Extrae el texto útil de la respuesta del cliente: si es JSON con un campo
 * `data` string, lo usa; si es JSON de otra forma, lo serializa; si no es
 * JSON, usa el texto tal cual (para no exigirle a n8n un formato rígido).
 */
function extractData(text: string): string {
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object' && typeof json.data === 'string') {
      return json.data;
    }
    return JSON.stringify(json);
  } catch {
    return text;
  }
}
