# Conectar tu cuenta a Claude (MCP)

MCP (*Model Context Protocol*) es el estándar con el que un asistente como
Claude se conecta a sistemas externos. Con el servidor MCP de agentes-lead,
Claude puede **consultar y operar tu cuenta en lenguaje natural**, desde la
misma ventana donde ya trabajas:

> — *¿Qué leads calientes tengo sin contactar?*
> — *Muéstrame la conversación con Ana Pérez.*
> — *Agéndame la visita con Bruno el viernes a las 11 en la oficina.*
> — *¿Cómo vino la semana comparada con la anterior?*

No reemplaza al panel: es otra puerta de entrada a lo mismo, útil cuando estás
preguntando y decidiendo más que haciendo clic.

**Requisitos**: Node 18 o superior en tu computador, y ser **OWNER** de la
empresa para poder crear la llave. No hay que instalar nada más — el servidor
no tiene dependencias.

> Este documento es la referencia completa, con la parte de desarrollo. La
> versión para el cliente vive **dentro del panel**, en **Ayuda**, y se escribe
> en `frontend/src/content/mcp-guide.{es,en}.md`: si cambias algo de la
> configuración o de las herramientas, actualiza los tres archivos.

---

## 1. Crear la llave

En el panel: **Integraciones → Acceso MCP → Crear llave**.

Ponle un nombre que te diga *qué* la está usando (`Claude de escritorio`,
`Claude del notebook`) y elige los permisos:

| Permiso | Puede |
|---|---|
| **Solo lectura** (recomendado para empezar) | Consultar leads, conversaciones, agenda, agentes y métricas. |
| **Lectura y escritura** | Todo lo anterior + crear leads, editar fichas, dejar notas internas y agendar o cancelar citas. |

> ⚠️ **La llave se muestra una sola vez.** Guardamos solo su huella
> (SHA-256), así que no se puede volver a consultar. Cópiala al momento; si se
> te pierde, revócala y crea otra. No pasa nada malo por tener varias.

Al crearla, el panel te muestra además **el bloque de configuración listo para
pegar**, con la llave y la URL ya puestas. Ábrelo con *"Ver la configuración
lista para pegar"* y salta al paso siguiente con eso copiado.

---

## 2. Configurar tu cliente

### Claude Desktop

Edita `claude_desktop_config.json`:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentes-lead": {
      "command": "node",
      "args": ["C:\\ruta\\a\\agentes-lead\\mcp\\server.mjs"],
      "env": {
        "AGENTES_LEAD_URL": "https://tu-api.up.railway.app",
        "AGENTES_LEAD_API_KEY": "ale_la_llave_que_copiaste"
      }
    }
  }
}
```

En Windows las rutas van con **doble barra invertida** (`\\`) o con barras
normales (`/`): una sola `\` rompe el JSON. Guarda y **reinicia Claude
Desktop** — la configuración solo se lee al arrancar.

### Claude Code

El mismo bloque en un `.mcp.json` en la raíz del proyecto, o de una línea:

```bash
claude mcp add agentes-lead --env AGENTES_LEAD_URL=https://tu-api.up.railway.app --env AGENTES_LEAD_API_KEY=ale_... -- node /ruta/a/agentes-lead/mcp/server.mjs
```

### Variables

| Variable | Qué es | Por defecto |
|---|---|---|
| `AGENTES_LEAD_API_KEY` | La llave del paso 1. **Obligatoria.** | — |
| `AGENTES_LEAD_URL` | Base de la API. En producción, la URL de tu backend. | `http://localhost:3000` |

---

## 3. Probar que quedó

Pídele: **"usa estadoConexion"**. Debería responderte con el nombre de tu
empresa, tu zona horaria y los permisos de la llave. Si eso funciona, todo lo
demás funciona.

---

## 4. Qué le puedes pedir

**Revisar la cartera**

- *¿Cuántos leads tengo en cada etapa del embudo?*
- *Muéstrame los leads calientes que están en conversación.*
- *Busca el lead de Ana Pérez y cuéntame de qué hablaron.*
- *¿Hay alguien esperando respuesta de un humano?*

**Operar** (necesita llave de lectura y escritura)

- *Crea un lead: Carla Soto, +56933333333, vino por Instagram.*
- *Marca el lead de Bruno como cerrado ganado.*
- *Deja una nota en el lead de Ana: pidió factura a nombre de la empresa.*
- *Agenda una demo con Diego el jueves 15:00 a 16:00 por Meet.*
- *Cancela la cita de mañana con Carla.*

**Entender cómo va el negocio**

- *¿Cómo vinieron los últimos 30 días?*
- *¿Qué agentes tengo configurados y cuál atiende por defecto?*
- *¿Qué tengo agendado esta semana?*

Las métricas que devuelve son **los números ya calculados y guardados**, no
estimaciones. Si le pides algo que no puede calcular con eso, lo dirá en vez
de inventarlo.

---

## 5. Referencia de herramientas

| Herramienta | Qué hace | Requiere escritura |
|---|---|---|
| `estadoConexion` | Empresa conectada, zona horaria y permisos de la llave | — |
| `listarLeads` | Lista leads con su último mensaje; filtra por estado y busca por texto | — |
| `verLead` | Ficha completa: datos, conversación, citas y notas internas | — |
| `listarAgentes` | Agentes configurados, canales que atienden y cuál es el predeterminado | — |
| `verAgenda` | Citas entre dos fechas | — |
| `verMetricas` | Métricas diarias de los últimos N días (1 a 90, por defecto 7) | — |
| `crearLead` | Alta manual. Necesita teléfono o email | sí |
| `actualizarLead` | Edita datos de contacto, estado del embudo o calificación | sí |
| `agregarNota` | Nota interna en el lead (la ve el equipo, no el lead) | sí |
| `agendarCita` | Agenda una cita. Falla si se choca con otra | sí |
| `cancelarCita` | Cancela una cita agendada | sí |

Con una llave de **solo lectura**, las de escritura ni siquiera aparecen en el
catálogo: Claude no las ve, así que no intenta usarlas.

**Fechas**: van en ISO 8601 **con zona horaria**
(`2026-09-20T15:00:00-03:00`). Si le dices "el viernes a las 11", Claude la
arma — pero si algo queda en otro horario del esperado, revisa que la zona
horaria de tu empresa esté bien en **Configuración**.

---

## 6. Lo que este MCP no puede hacer

**No puede mandarle un mensaje a una persona.** No responde WhatsApp, no manda
correos, no inicia llamadas. Eso es deliberado, no una funcionalidad pendiente:
al otro lado hay un modelo de lenguaje corriendo en tu computador, y un texto
malicioso metido en la ficha de un lead no puede terminar en un mensaje a un
cliente tuyo. Esas acciones se hacen desde el panel, donde hay una persona
mirando antes de apretar enviar.

Tampoco expone la configuración sensible (secretos de webhooks, credenciales
de WhatsApp o de voz), ni la administración de usuarios, ni nada de otras
empresas: la llave está amarrada a una sola empresa y el aislamiento es el
mismo del resto del sistema.

---

## 7. Seguridad

- **Se guarda solo el hash.** Ni nosotros podemos leer tu llave después de
  creada; el panel muestra únicamente el prefijo (`ale_a1b2c3…`) para que la
  reconozcas.
- **Una llave por cliente.** Si usas Claude en dos computadores, crea dos
  llaves: así puedes revocar una sin dejar sin acceso a la otra.
- **Solo lectura por defecto.** Sube los permisos cuando de verdad los
  necesites.
- **Revocar es inmediato.** En la lista, *Revocar*: el cliente que la esté
  usando deja de entrar en la siguiente petición. La llave no se borra — queda
  el registro de que existió y cuándo dejó de servir.
- **"Último uso"** te delata una llave olvidada que sigue entrando.
- Todo lo que la llave hace queda en la **auditoría a nombre de quien la
  emitió**. Si creaste la llave tú, los cambios aparecen como tuyos.
- La llave queda **en texto plano en el archivo de configuración** de tu
  cliente MCP. Trátalo como una contraseña: no lo subas a un repositorio ni lo
  mandes por chat.

---

## 8. Problemas frecuentes

| Síntoma | Causa / arreglo |
|---|---|
| El servidor no aparece en el cliente | JSON mal formado (coma de más, `\` sin escapar en Windows) o no reiniciaste el cliente después de editarlo. |
| *"Falta AGENTES_LEAD_API_KEY"* | El bloque `env` no llegó al proceso: revisa que esté **dentro** del objeto del servidor, no fuera. |
| *"La llave de API no es válida, está revocada o venció"* | La llave está mal copiada (¿quedó un espacio?), fue revocada, o apunta a otra instalación distinta de la que la emitió. |
| *"Esa llave no tiene permiso para esta acción"* | Es de solo lectura y le pediste escribir. Crea una de lectura y escritura. |
| Solo aparecen herramientas de consulta | Lo mismo de arriba: la llave es de solo lectura. Es el comportamiento esperado. |
| *"No se pudo conectar con …"* | `AGENTES_LEAD_URL` apunta a `localhost` pero tu API está en Railway (o el backend está apagado). |
| *"La API no respondió en 15s"* | Backend dormido o sobrecargado. Reintenta; si se repite, mira los logs del servidor. |
| Error 500 al abrir **Acceso MCP** en el panel | Falta aplicar la migración de llaves: `npx prisma migrate deploy`. |
| Las citas quedan en otro horario | Manda la fecha con zona horaria explícita y revisa la zona de la empresa en **Configuración**. |

Para ver qué está pasando por dentro, el servidor escribe sus mensajes en
**stderr** (los logs del cliente MCP), nunca en stdout — ahí va el protocolo.

---

## 9. Para desarrolladores

El código vive en [`mcp/`](../mcp) y no tiene dependencias: implementa
JSON-RPC 2.0 sobre stdio a mano en vez de usar `@modelcontextprotocol/sdk`,
porque el árbol npm/pnpm del repo está en conflicto y agregar paquetes rompe
`node_modules` (el parser de CSV de la importación es propio por lo mismo).

| Archivo | Rol |
|---|---|
| `mcp/server.mjs` | Entrada: transporte stdio, permisos de la llave, arranque |
| `mcp/protocol.mjs` | JSON-RPC 2.0 y handshake de MCP |
| `mcp/client.mjs` | Cliente HTTP de `/api/v1` |
| `mcp/tools.mjs` | Catálogo de herramientas y recorte de respuestas |

Del lado del backend:

| Ruta | Rol |
|---|---|
| `src/api/api.controller.ts` | La superficie `/api/v1`. Lista **curada a mano**, no un espejo del panel |
| `src/api-keys/api-keys.service.ts` | Alta, revocación y validación de llaves (hash SHA-256) |
| `src/api-keys/api-key.guard.ts` | Autentica por llave y deja el request igual que el camino del panel |

`ApiKeyGuard` fija `req.user`, `req.membership` y el `companyId` del
`TenantContext`, así que `RolesGuard` y el aislamiento multi-tenant de Prisma
funcionan sin cambios. El controlador no tiene servicios propios: reusa los
del panel, o sea misma lógica y misma auditoría.

### Agregar una herramienta

1. Expón el endpoint en `src/api/api.controller.ts` (con `@Roles(...)` si
   escribe). **Piensa dos veces** antes de exponer algo que salga hacia una
   persona real.
2. Agrega la entrada en `TOOLS` de `mcp/tools.mjs`: `name`, `description`,
   `inputSchema`, `escritura` y `run`. La descripción es lo que lee el modelo
   para decidir si usarla: sé explícito.
3. Recorta la respuesta en `run` a lo que el modelo necesita — la API devuelve
   la ficha completa y eso gasta contexto de más.
4. Tests: `npm run test:mcp` (servidor MCP) y `npm test` (backend).

Hay un test que **falla a propósito** si alguien agrega una herramienta cuyo
nombre sugiera mandar mensajes (`enviar`, `responder`, `llamar`, `whatsapp`).
Si lo tocas, es porque estás cambiando una decisión de diseño, no un detalle.
