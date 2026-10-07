const RESEND_API = 'https://api.resend.com';

/** Un registro DNS que la empresa tiene que crear, tal como lo entrega Resend. */
export interface ResendDnsRecord {
  /** Para qué sirve: DKIM, SPF, Tracking… */
  record: string;
  /** Nombre del registro, relativo al dominio principal (p. ej. "send.notificaciones"). */
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
  priority?: number;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records: ResendDnsRecord[];
}

/** Error de la API de Resend, con un mensaje que se puede mostrar en el panel. */
export class ResendApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ResendApiError';
  }
}

/** Estados de Resend en los que el dominio ya sirve para enviar. */
export const SENDABLE_DOMAIN_STATUSES = new Set([
  'verified',
  'partially_verified',
]);

/**
 * Cliente de la API de dominios de Resend, con la API key de la PLATAFORMA:
 * da de alta el dominio de una empresa, dispara su verificación y consulta en
 * qué va. Doc: https://resend.com/docs/api-reference/domains/create-domain
 */
export class ResendDomainsClient {
  constructor(private readonly apiKey: string) {}

  /** Da de alta el dominio. Queda en `not_started` hasta que se verifique. */
  create(name: string, region: string): Promise<ResendDomain> {
    return this.request<ResendDomain>('POST', '/domains', { name, region });
  }

  /**
   * Dispara la verificación. Desde ahí Resend revisa los DNS por 72 h: la
   * empresa puede crear los registros después, y el dominio se verifica solo.
   */
  async verify(id: string): Promise<void> {
    await this.request('POST', `/domains/${encodeURIComponent(id)}/verify`);
  }

  get(id: string): Promise<ResendDomain> {
    return this.request<ResendDomain>(
      'GET',
      `/domains/${encodeURIComponent(id)}`,
    );
  }

  /** Borra el dominio. Si ya no existe en Resend, no es un error. */
  async remove(id: string): Promise<void> {
    try {
      await this.request('DELETE', `/domains/${encodeURIComponent(id)}`);
    } catch (e) {
      if (!(e instanceof ResendApiError && e.status === 404)) {
        throw e;
      }
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${RESEND_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ResendApiError(res.status, describeError(res.status, detail));
    }
    return (await res.json().catch(() => ({}))) as T;
  }
}

/** Mensaje legible para el panel a partir de la respuesta de error de Resend. */
function describeError(status: number, detail: string): string {
  let message = '';
  try {
    message = String(
      (JSON.parse(detail) as { message?: unknown }).message ?? '',
    );
  } catch {
    message = detail.slice(0, 200);
  }
  if (status === 401) {
    return 'La API key de Resend de la plataforma no es válida.';
  }
  if (status === 403) {
    const hint =
      'la API key de la plataforma necesita permiso "Full access" para ' +
      'administrar dominios';
    return message
      ? `Resend respondió 403: ${message} (si es por permisos, ${hint}).`
      : `Resend rechazó la operación: ${hint}.`;
  }
  return message
    ? `Resend respondió ${status}: ${message}`
    : `Resend respondió ${status}.`;
}

/**
 * Nombre completo de un registro DNS. Resend lo da relativo al dominio
 * principal: para `notificaciones.cliente.cl` entrega
 * `resend._domainkey.notificaciones`. Hay proveedores de DNS que piden el
 * nombre completo (`resend._domainkey.notificaciones.cliente.cl`): se arma
 * juntando el nombre con la parte del dominio que no repite.
 */
export function recordFqdn(name: string, domain: string): string {
  const nameLabels = name.toLowerCase().split('.').filter(Boolean);
  const domainLabels = domain.toLowerCase().split('.').filter(Boolean);
  // Cuántas etiquetas del final del nombre coinciden con el comienzo del dominio.
  let overlap = 0;
  for (let k = Math.min(nameLabels.length, domainLabels.length); k > 0; k--) {
    const tail = nameLabels.slice(nameLabels.length - k).join('.');
    const head = domainLabels.slice(0, k).join('.');
    if (tail === head) {
      overlap = k;
      break;
    }
  }
  return [...nameLabels, ...domainLabels.slice(overlap)].join('.');
}
