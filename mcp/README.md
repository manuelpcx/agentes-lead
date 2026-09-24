# Servidor MCP de agentes-lead

Conecta una cuenta de agentes-lead a un cliente MCP (Claude Desktop, Claude
Code, …) para consultar y operar leads, agenda, agentes y métricas en lenguaje
natural.

📖 **La guía completa —crear la llave, configurar el cliente, qué preguntarle,
seguridad y problemas frecuentes— está en [`docs/MCP.md`](../docs/MCP.md).**
Este archivo es la nota técnica de al lado del código.

## Arranque rápido

```json
{
  "mcpServers": {
    "agentes-lead": {
      "command": "node",
      "args": ["/ruta/a/agentes-lead/mcp/server.mjs"],
      "env": {
        "AGENTES_LEAD_URL": "https://tu-api.up.railway.app",
        "AGENTES_LEAD_API_KEY": "ale_..."
      }
    }
  }
}
```

La llave se crea en el panel: **Integraciones → Acceso MCP**. Sin dependencias:
solo necesita **Node 18+**, no hay que correr `npm install`.

## Estructura

| Archivo | Rol |
|---|---|
| `server.mjs` | Entrada: transporte stdio, permisos de la llave, arranque |
| `protocol.mjs` | JSON-RPC 2.0 y handshake de MCP |
| `client.mjs` | Cliente HTTP de `/api/v1` |
| `tools.mjs` | Catálogo de herramientas y recorte de respuestas |

El protocolo está implementado a mano en vez de con
`@modelcontextprotocol/sdk` porque el árbol de dependencias del repo está en
conflicto (npm/pnpm) y agregar paquetes rompe `node_modules` — el parser de CSV
de la importación es propio por lo mismo. El efecto secundario es bueno: cero
dependencias significa que instalarlo es copiar una ruta.

El transporte de MCP por stdio es **un mensaje JSON por línea** (no lleva el
`Content-Length` de LSP). Todo lo que se imprima por stdout es protocolo: los
mensajes para humanos van a **stderr** o rompen la sesión.

## Del lado del backend

`/api/v1` (`src/api/`) se autentica con `ApiKeyGuard` (`src/api-keys/`) y reusa
los servicios del panel, así que comparte lógica, auditoría y aislamiento
multi-tenant. Es una lista curada a mano: **no expone nada que le mande un
mensaje a una persona real**.

## Tests

```bash
node --test "*.test.mjs"   # desde mcp/
npm run test:mcp           # desde la raíz
```

Cubren el handshake completo contra una API falsa (proceso real, stdio real),
el recorte de cada herramienta, el filtrado por permisos y el manejo de
errores.
