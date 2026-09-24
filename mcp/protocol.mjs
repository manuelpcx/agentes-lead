/**
 * Capa MCP: JSON-RPC 2.0 sobre líneas de texto.
 *
 * Está escrita a mano en vez de usar `@modelcontextprotocol/sdk` por una razón
 * concreta de este proyecto: el árbol de dependencias de npm/pnpm está en
 * conflicto y agregar paquetes rompe `node_modules` (por eso el parser de CSV
 * también es propio). De paso, que el servidor MCP no tenga dependencias
 * significa que quien lo instale solo necesita Node: ni `npm install`.
 *
 * El transporte de MCP por stdio es un mensaje JSON por línea — no lleva el
 * `Content-Length` de LSP.
 */

/** Versiones del protocolo que sabemos hablar, de la más nueva a la más vieja. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** Códigos de error de JSON-RPC 2.0. */
export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

export function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Respuesta de herramienta: siempre texto, para máxima compatibilidad. */
export function toolText(value, isError = false) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Arma el despachador de mensajes. `listTools` y `callTool` los inyecta el
 * servidor, así esta capa se puede probar sin red ni stdio.
 */
export function createHandler({ serverInfo, listTools, callTool }) {
  return async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return jsonRpcError(
        message?.id ?? null,
        ERROR_CODES.invalidRequest,
        'Mensaje JSON-RPC inválido',
      );
    }

    // Sin `id` es una notificación: no se responde nunca.
    const isNotification = message.id === undefined || message.id === null;
    const { id, method, params } = message;

    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : LATEST_PROTOCOL_VERSION;
          return jsonRpcResult(id, {
            protocolVersion: version,
            // Solo herramientas: este servidor no expone recursos ni prompts.
            capabilities: { tools: { listChanged: false } },
            serverInfo,
          });
        }

        case 'ping':
          return jsonRpcResult(id, {});

        case 'tools/list':
          return jsonRpcResult(id, { tools: await listTools() });

        case 'tools/call': {
          const name = params?.name;
          if (typeof name !== 'string') {
            return jsonRpcError(
              id,
              ERROR_CODES.invalidParams,
              'Falta el nombre de la herramienta',
            );
          }
          return jsonRpcResult(id, await callTool(name, params?.arguments ?? {}));
        }

        default:
          // Las notificaciones desconocidas (initialized, cancelled, progreso…)
          // se ignoran en silencio: responderles rompe el protocolo.
          if (isNotification) return null;
          return jsonRpcError(
            id,
            ERROR_CODES.methodNotFound,
            `Método no soportado: ${method}`,
          );
      }
    } catch (e) {
      if (isNotification) return null;
      return jsonRpcError(
        id,
        ERROR_CODES.internal,
        e?.message ?? 'Error interno del servidor MCP',
      );
    }
  };
}

/**
 * Parte un buffer de stdin en líneas completas. Devuelve las líneas listas y
 * lo que queda a medias, que se guarda para el próximo chunk.
 */
export function splitLines(buffer) {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}
