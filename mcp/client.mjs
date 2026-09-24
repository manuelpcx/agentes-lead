/**
 * Cliente HTTP de la API de agentes-lead (`/api/v1`), autenticado por llave.
 * Sin dependencias: `fetch` viene en Node 18+.
 */

/** Si la API no responde en este tiempo, mejor un error claro que colgarse. */
const TIMEOUT_MS = 15_000;

/** Error de la API con el status a la vista, para poder explicarlo bien. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Traduce el status HTTP a algo que un humano (o un modelo) entienda. */
function explain(status, detail) {
  if (status === 401) {
    return 'La llave de API no es válida, está revocada o venció. Genera una nueva en el panel (Integraciones → Acceso MCP).';
  }
  if (status === 403) {
    return 'Esa llave no tiene permiso para esta acción. Las llaves de solo lectura no pueden escribir.';
  }
  if (status === 404) {
    return `No se encontró lo que pediste. ${detail}`.trim();
  }
  if (status === 409) {
    return `Hay un conflicto con lo que ya existe. ${detail}`.trim();
  }
  return detail || `La API respondió ${status}.`;
}

/** Saca el mensaje del cuerpo de error de Nest, que a veces es un arreglo. */
function detailFrom(text) {
  try {
    const body = JSON.parse(text);
    const message = body?.message ?? body?.error;
    return Array.isArray(message) ? message.join(' · ') : (message ?? '');
  } catch {
    return text.slice(0, 300);
  }
}

export function createClient({ baseUrl, apiKey }) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '');

  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${root}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new ApiError(
        0,
        timedOut
          ? `La API no respondió en ${TIMEOUT_MS / 1000}s (${root}).`
          : `No se pudo conectar con ${root}: ${e?.message ?? e}`,
      );
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new ApiError(res.status, explain(res.status, detailFrom(text)));
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
  };
}
