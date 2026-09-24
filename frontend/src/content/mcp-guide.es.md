# Conectar tu cuenta a Claude

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) es el estándar con el que un asistente como Claude se conecta a sistemas externos. Con él, Claude puede **consultar y operar tu cuenta en lenguaje natural**, desde la misma ventana donde ya trabajas:

> — *¿Qué leads calientes tengo sin contactar?* — *Muéstrame la conversación con Ana Pérez.* — *Agéndame la visita con Bruno el viernes a las 11.* — *¿Cómo vino la semana?*

No reemplaza al panel: es otra puerta de entrada a lo mismo, útil cuando estás preguntando y decidiendo más que haciendo clic.

**Necesitas** Node 18 o superior en tu computador y ser **OWNER** de la empresa. Nada más: el servidor no tiene dependencias que instalar.

---

## 1. Crear la llave

Ve a **Integraciones → Acceso MCP → Crear llave**.

Ponle un nombre que te diga *qué* la está usando (`Claude de escritorio`, `Claude del notebook`) y elige los permisos:

| Permiso | Puede |
|---|---|
| **Solo lectura** (recomendado para empezar) | Consultar leads, conversaciones, agenda, agentes y métricas. |
| **Lectura y escritura** | Todo lo anterior + crear leads, editar fichas, dejar notas internas y agendar o cancelar citas. |

> ⚠️ La llave se muestra **una sola vez**. Guardamos solo su huella, así que no se puede volver a consultar. Cópiala al momento; si se te pierde, revócala y crea otra. No pasa nada malo por tener varias.

Al crearla, el panel te muestra el bloque de configuración **listo para pegar**, con la llave y la URL ya puestas. Ábrelo con *"Ver la configuración lista para pegar"* y sigue con eso copiado.

---

## 2. Configurar tu cliente

### Claude Desktop

Edita el archivo `claude_desktop_config.json`:

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

En Windows las rutas van con **doble barra invertida** o con barras normales: una sola barra invertida rompe el JSON. Guarda y **reinicia Claude Desktop** — la configuración solo se lee al arrancar.

### Claude Code

El mismo bloque en un `.mcp.json` en la raíz del proyecto, o de una línea:

```bash
claude mcp add agentes-lead --env AGENTES_LEAD_URL=https://tu-api.up.railway.app --env AGENTES_LEAD_API_KEY=ale_... -- node /ruta/a/agentes-lead/mcp/server.mjs
```

### Variables

| Variable | Qué es | Por defecto |
|---|---|---|
| `AGENTES_LEAD_API_KEY` | La llave del paso 1. **Obligatoria.** | — |
| `AGENTES_LEAD_URL` | Base de la API. La que aparece en el bloque de configuración. | `http://localhost:3000` |

---

## 3. Probar que quedó

Pídele: **"usa estadoConexion"**. Debería responderte con el nombre de tu empresa, tu zona horaria y los permisos de la llave. Si eso funciona, todo lo demás funciona.

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

Las métricas que devuelve son **los números ya calculados y guardados**, no estimaciones. Si le pides algo que no puede calcular con eso, lo dirá en vez de inventarlo.

---

## 5. Herramientas disponibles

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

Con una llave de **solo lectura**, las de escritura ni siquiera aparecen en el catálogo: Claude no las ve, así que no intenta usarlas.

**Fechas**: si algo queda en un horario distinto del esperado, revisa que la zona horaria de tu empresa esté bien en **Configuración**.

---

## 6. Lo que no puede hacer

**No puede mandarle un mensaje a una persona.** No responde WhatsApp, no manda correos, no inicia llamadas. Es deliberado, no una funcionalidad pendiente: al otro lado hay un modelo de lenguaje corriendo en tu computador, y un texto malicioso metido en la ficha de un lead no puede terminar en un mensaje a un cliente tuyo. Esas acciones se hacen desde el panel, donde hay una persona mirando antes de apretar enviar.

Tampoco expone la configuración sensible (secretos de webhooks, credenciales de WhatsApp o de voz), ni la administración de usuarios, ni nada de otras empresas.

---

## 7. Seguridad

- **Se guarda solo la huella.** Ni nosotros podemos leer tu llave después de creada; el panel muestra únicamente el prefijo para que la reconozcas.
- **Una llave por cliente.** Si usas Claude en dos computadores, crea dos llaves: así puedes revocar una sin dejar sin acceso a la otra.
- **Solo lectura por defecto.** Sube los permisos cuando de verdad los necesites.
- **Revocar es inmediato.** El cliente que la esté usando deja de entrar en la siguiente petición. La llave no se borra: queda el registro de que existió y cuándo dejó de servir.
- **"Último uso"** te delata una llave olvidada que sigue entrando.
- Todo lo que la llave hace queda en la **auditoría a nombre de quien la emitió**.
- La llave queda **en texto plano en el archivo de configuración** de tu cliente. Trátalo como una contraseña: no lo subas a un repositorio ni lo mandes por chat.

---

## 8. Problemas frecuentes

| Síntoma | Causa / arreglo |
|---|---|
| El servidor no aparece en el cliente | JSON mal formado (coma de más, barra invertida sin escapar en Windows) o no reiniciaste el cliente después de editarlo. |
| *"Falta AGENTES_LEAD_API_KEY"* | El bloque `env` no llegó al proceso: revisa que esté **dentro** del objeto del servidor, no fuera. |
| *"La llave de API no es válida, está revocada o venció"* | La llave está mal copiada (¿quedó un espacio?), fue revocada, o apunta a otra instalación distinta de la que la emitió. |
| *"Esa llave no tiene permiso para esta acción"* | Es de solo lectura y le pediste escribir. Crea una de lectura y escritura. |
| Solo aparecen herramientas de consulta | Lo mismo de arriba: la llave es de solo lectura. Es el comportamiento esperado. |
| *"No se pudo conectar con …"* | La URL apunta a `localhost` pero tu API está en otro lado (o el servicio está apagado). |
| *"La API no respondió en 15s"* | Servidor dormido o sobrecargado. Reintenta; si se repite, avísanos. |
| Las citas quedan en otro horario | Revisa la zona horaria de la empresa en **Configuración**. |
