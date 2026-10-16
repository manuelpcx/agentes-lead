# Guía del panel

Recorrido por el panel, menú por menú. Es la referencia que lee el asistente de
ayuda y la que se muestra en la pestaña **Ayuda** de la aplicación.

Para instalar, registrar la empresa y conectar la entrada de leads, ver
[`GUIA_DE_USO.md`](GUIA_DE_USO.md).

---

## Asistente (pantalla de inicio)

Lo primero que ves al entrar. Es un chat donde puedes:

- **Preguntar cómo usar el panel.** Conoce esta guía y el estado real de tu
  cuenta, así que responde con tus agentes y tus integraciones, no en abstracto.
- **Crear, editar o eliminar un agente.** Te pregunta lo que falte y arma una
  propuesta. **Nunca ejecuta nada solo**: la propuesta aparece con un botón y
  no pasa nada hasta que la confirmas. Eliminar es irreversible y el botón se
  muestra en rojo.
- **Mejorar el prompt de un agente.** Parte del prompt actual y propone una
  versión nueva con el cambio que le pidas. También pasa por tu confirmación.
- **Cargar un documento al conocimiento.** Arrastra un archivo `.txt`, `.md`,
  `.csv` o `.json` sobre el chat y queda indexado.

En el resto de las pantallas el asistente sigue disponible como **burbuja
flotante** abajo a la derecha.

El asistente no gestiona tus leads ni habla con tus clientes. Para eso está la
Bandeja.

---

## Bandeja

La lista de conversaciones en vivo, con el último mensaje de cada lead. Se
refresca sola.

- **Buscar** por nombre, teléfono o email.
- **Filtrar** por estado del embudo.
- **Nuevo lead**: alta manual. Necesita al menos teléfono o email. Se comporta
  igual que uno que entró por el webhook: se le asigna agente y se programa el
  primer contacto.
- **Importar**: trae tu base desde otro CRM (ver más abajo).

### Detalle de un lead

Al entrar a un lead ves:

- **El hilo completo**, con cada mensaje marcado según quién lo escribió:
  cliente, agente, operador (alguien de tu equipo) o sistema. Los adjuntos que
  el agente no puede abrir aparecen como `[El cliente envió un audio]`.
- **Responder tú**: para escribir necesitas **Tomar control**, que pausa al
  agente en ese lead. **Devolver al agente** lo reactiva. El agente ve tus
  mensajes marcados como del operador y no los repite ni los contradice.
- **Memoria del lead**: lo que el agente sabe de esa persona y arrastra entre
  conversaciones, incluso meses después: qué le interesa, objeciones, horarios,
  quién decide. La escribe el agente solo, y **puedes corregirla**: editar el
  resumen, agregar un dato o borrar uno que esté mal.
- **Notas internas**: para tu equipo. El agente las recibe como contexto y no se
  las lee al cliente.
- **Citas** del lead y **registro de acciones** del agente: qué herramienta usó
  y con qué resultado.
- **Calificación** (ver abajo) y datos de contacto, editables.

Requiere rol OWNER u OPERADOR para responder, tomar control y escribir notas.

### Calificación del lead

Es distinta del estado del embudo: mide **interés y urgencia reales**. La pone
el agente cuando aparece una señal concreta, no en cada mensaje.

| Nivel | Qué significa |
|---|---|
| FRÍO | Sin señales de interés real, o compra lejana |
| TIBIO | Interés genuino, pero sin presupuesto ni plazo claros |
| CALIENTE | Presupuesto, urgencia y poder de decisión confirmados |

Con CALIENTE es cuando tiene sentido ofrecer una llamada.

### Importar leads desde otro CRM

Botón **Importar** en la Bandeja.

1. En tu CRM busca "Exportar" y elige formato CSV. Si lo tienes en Excel,
   *Guardar como > CSV*.
2. Sube el archivo. Hasta **5.000 contactos por vez**; si tienes más, divídelo.
3. Revisa el **mapeo de columnas**: el sistema propone qué columna es el
   nombre, el teléfono, el email, etc. Corrige lo que haga falta. Necesitas al
   menos teléfono o email, si no, no hay a quién contactar.
4. Elige qué pasa con los contactos que ya existen y si quieres que el agente
   **les escriba al terminar**.

Ese último interruptor importa: **apagado**, los contactos quedan guardados y
nadie recibe mensajes. **Encendido**, el agente inicia conversación de a uno por
minuto, y nunca con los que importes como cerrados (ganados o perdidos).

Nada se importa hasta que confirmas el mapeo. Al terminar se listan las filas
que no se pudieron traer y por qué.

---

## Calendario

Vista mensual de las citas: las que agenda el agente y las que agendas tú.

- **Nueva cita**: título, lead, fecha, hora, lugar. El lead se busca por nombre
  o teléfono.
- Avisa si el horario **se solapa** con otra cita.
- Cancelar una cita significa que el lead **no recibirá el recordatorio**.

Las citas del lead también aparecen en su ficha, y el agente las ve en su
contexto: no vuelve a agendar una que ya existe y te la confirma si el cliente
pregunta.

---

## Conocimiento

Lo que el agente puede consultar. Fuera de esto no inventa: si no encuentra el
dato, lo dice y ofrece escalar.

Dos tipos de contenido, y la diferencia importa:

- **Documentos**: texto libre (servicios, FAQs, políticas). Se parten en
  fragmentos y se indexan para búsqueda por significado. Es lo que responde
  preguntas abiertas.
- **Datos**: pares clave/valor para lo **exacto y vigente**: precios, horarios,
  políticas. El valor va en formato JSON, por ejemplo
  `{"monto": 45000, "moneda": "CLP"}`. Es la única fuente válida para una cifra.

Toda cifra que el agente le diga a un cliente tiene que venir de acá o de otra
herramienta. Si no puede respaldarla, el mensaje se bloquea y el lead se escala
a una persona.

**Eliminar**: cada documento y cada dato tiene su botón, con confirmación. Al
eliminarlo el agente deja de usarlo de inmediato, pero la fila se conserva
para el historial de versiones. Con **Ver eliminados** los vuelves a ver,
tachados.

**Pregúntale al conocimiento**: prueba qué recuperaría el agente ante una
pregunta, sin gastar una conversación real.

---

## Aprobación

Nada entra a la base ni al comportamiento del agente sin tu visto bueno. Tres
bandejas:

- **Cumplimiento**: momentos donde el agente no respetó una de sus propias
  reglas en una conversación real, con la cita textual que lo muestra.
  Aprobarlo lo deja como antecedente para la próxima propuesta de prompt; por
  sí solo no cambia nada.
- **Vacíos de conocimiento**: preguntas que el agente no supo responder, con
  cuántas veces se las hicieron. Escribes la respuesta y al aprobar se indexa
  como FAQ.
- **Ejemplos**: buenas respuestas detectadas en conversaciones reales. Al
  aprobarlas, el agente las usa como referencia de estilo en casos parecidos.

Todo esto lo alimenta un análisis que corre de noche sobre las conversaciones
ya terminadas.

---

## Prompts

Las reglas de cada agente, en versiones.

- Editas el prompt y **guardar crea una versión nueva y la activa de
  inmediato**. No hay paso de aprobación aparte: la edición es tuya.
- **Restablecer al prompt por defecto** vuelve al inicial de ese tipo de agente.
- El **playbook semanal** propone versiones nuevas a partir de lo aprobado en
  Aprobación. Llegan **inactivas**: tú revisas y activas la que quieras.

Cuidado al reescribir: el prompt trae reglas de seguridad (no inventar cifras,
usar herramientas para precios, escalar cuando falta un dato, cumplimiento de
cobranza). Si las borras, el agente deja de seguirlas.

---

## Métricas

Actividad de los últimos días: leads, citas, mensajes, escalamientos, y el
detalle por día.

**Recalcular hoy** fuerza el cálculo del día en curso, que normalmente se hace
de noche.

En **Agentes** tienes además las métricas comparadas entre agentes.

---

## Agentes

Quién atiende y cómo.

- **Tipo**: VENTAS, COBRANZA, SOPORTE, AGENDAMIENTO o CUSTOM. Ventas y cobranza
  parten con un prompt especializado; el resto, con una base genérica.
- **Descripción**: ayuda al clasificador a decidir cuándo derivarle un lead.
- **Enrutamiento**: qué canales atiende (toca WhatsApp, Correo o Llamada para
  marcarlos) y qué estados del embudo maneja. Vacío significa "cualquiera". El **agente por defecto** recibe lo que no calza con
  ningún otro.
- **Desactivar** es reversible: sus leads se reasignan al agente por defecto.
  Eliminar no lo es.
- **Métricas comparadas** y **traspasos** entre agentes, para ver quién deriva a
  quién.

### Seguimiento por agente

Opcional. Lo que dejes vacío usa la configuración global. Sirve para que
cobranza y ventas tengan cadencias distintas.

- **Escalera de contacto**: una línea de tiempo que parte en "Lead nuevo", con
  un paso por intento y la espera entre ellos. **Personalizar** la arma con los
  canales del agente y las esperas generales. Toca un paso para cambiarle el
  canal, moverlo o quitarlo; **+ Paso** agrega uno. Las esperas y la demora del
  primer contacto se eligen en cada tramo. Si el tope de intentos supera los
  pasos, la escalera vuelve a empezar. Un paso con un canal que el agente no
  atiende se marca en rojo.
- **Plantillas de WhatsApp** por propósito: apertura (primer contacto fuera de
  la ventana de 24 h), seguimiento y reactivación (último intento antes de
  cerrar).

**Agentes de cobranza: piso legal.** Por la Ley 19.496 (art. 37), el sistema
aplica límites que esta configuración no puede saltarse. Puedes ser más
estricto, nunca más amplio:

- Por WhatsApp y correo, como máximo 2 contactos proactivos por semana
  calendario, con al menos 48 h entre uno y otro.
- Como máximo 1 llamada proactiva por semana.
- Solo de lunes a sábado, sin festivos, de 8:00 a 20:00 en la hora del lead,
  aunque tu horario hábil sea más amplio. Las llamadas de cobranza siguen este
  horario siempre, aunque el deudor pida que lo llamen a otra hora: el agente
  la agenda para el primer momento permitido.

Responder cuando el deudor escribe no cuenta como contacto proactivo, y tampoco
la llamada que él mismo pidió. Si un seguimiento pasaría un límite, se pospone
solo, sin gastar un intento.

---

## Plantillas de WhatsApp

WhatsApp solo permite texto libre dentro de las **24 horas** siguientes al
último mensaje del cliente. Fuera de esa ventana hay que usar una plantilla
aprobada por Meta.

- El **nombre** va en minúsculas, números y guion bajo: `recordatorio_pago`.
- Las **variables** se escriben `{{1}}`, `{{2}}`, … El sistema las rellena con
  el nombre del lead y el de tu empresa, en ese orden.
- Meta exige **ejemplos** de cada variable para revisarla.
- La aprobación la decide Meta, no nosotros: suele tardar de minutos a unas 24
  horas. Usa **Actualizar** para ver el estado.

Solo las plantillas **aprobadas** se pueden asignar a un agente.

---

## Integraciones

Tus propias cuentas de proveedores. Los secretos se guardan cifrados y **nunca
se muestran de vuelta**.

- **WhatsApp**: Meta Cloud API directo, o YCloud como intermediario.
- **Correo**: sale por nuestra cuenta de envío; no necesitas cuenta propia.
- **Voz**: tus agentes llaman con nuestra cuenta de voz, dentro de tus minutos
  del mes. Muestra cuántos llevas. Las llamadas salen desde un número de la
  plataforma que no recibe llamadas: si el cliente quiere volver a hablar, el
  agente lo coordina por WhatsApp. En **Avanzado** puedes conectar tu propia
  cuenta de Retell, Vapi o ElevenLabs.
- **CRM**: envía eventos a tu CRM y le permite al agente consultarlo en vivo.

**Correo con tu dominio.** En la tarjeta de Correo escribes tu dominio
(conviene un subdominio, como `notificaciones.tuempresa.cl`) y aparecen los
registros DNS que tienes que crear donde administras tu dominio, con botones
para copiarlos. Lo revisamos cada 10 minutos: apenas quedan bien, los correos
salen desde tu dominio. Mientras tanto salen desde un dominio de la plataforma,
con el nombre de tu empresa como remitente. Completa **Las respuestas llegan
a** con tu buzón real: sin él, las respuestas de tus clientes no llegan a
nadie. Hay un tope de correos por día por empresa. Si prefieres tu propia
cuenta de Resend o SMTP, está en **Avanzado**.

**Conecta el webhook.** En WhatsApp y en Voz, al elegir el proveedor aparece la
URL que tienes que pegar en su panel, con un botón para copiarla, y los pasos:
qué evento activar y de dónde sale el secreto. Con Meta también aparece el
token de verificación. La URL es la misma para todas las empresas: cada mensaje
se asigna a la tuya por tu número de negocio (YCloud) o tu *Phone Number ID*
(Meta), que se registran solos al guardar la integración.

**Secreto de firma del webhook.** Cada canal de entrada lo necesita y es
**obligatorio**: sin él, los mensajes entrantes se rechazan. Con Meta es el
*App Secret* de tu app; con YCloud, el secreto del endpoint de webhook, que es
distinto de la API key; con Vapi, el *Server URL Secret*; con ElevenLabs, el
secreto HMAC del webhook post-llamada. Si dejaron de entrar mensajes, revisa
esto primero.

**Probar conexión** verifica las credenciales antes de dejarlas en producción.

**Avisos de proveedores.** Si WhatsApp, el correo, las llamadas o la IA dejan
de funcionar, aparece un aviso arriba en todas las páginas: rojo si el problema
es de tu cuenta (dice el motivo y qué hacer, por ejemplo "Recarga saldo en
YCloud"), ámbar si es de nuestra parte. Al dueño le llega además un correo. El
aviso se cierra solo cuando el proveedor vuelve a funcionar.

### Acceso MCP

Crea una llave para hablarle a tu cuenta desde Claude (Desktop o Code) en
lenguaje natural: consultar leads y conversaciones, agendar, dejar notas,
revisar métricas. La llave se muestra **una sola vez**. Paso a paso en la guía
de MCP, en esta misma pestaña de Ayuda.

---

## Configuración

Identidad y reglas de operación de la empresa.

- **ID de empresa**: el que va en el webhook de leads, cabecera `X-Company-Id`.
- **Zona horaria**: la que usa el agente para fechas, horarios y seguimientos.
- **Número de WhatsApp de negocio** en formato E.164, por ejemplo
  `+56911111111`. YCloud lo usa para enrutar los mensajes entrantes a tu
  empresa. El campo *Phone Number ID* es solo para Meta Cloud API directo: con
  YCloud, déjalo vacío. Los dos se completan solos al guardar la integración de
  WhatsApp.
- **Horario hábil**, en JSON. El agente no hace seguimiento fuera de él: lo
  pospone hasta la próxima hora permitida.
- **Voz del agente**: voz del catálogo del proveedor, tono e idioma, y el saludo
  con que abre la llamada. El tono se escribe en lenguaje natural, por ejemplo
  "cercano y directo, frases cortas, sin tecnicismos".

---

## Ayuda

Esta guía y la de MCP, con buscador por secciones. El asistente flotante
responde sobre lo mismo, pero preguntando.

Ahí también está **Ver el tour de nuevo**: el recorrido guiado que sale la
primera vez que entras, por si quieres repasarlo o mostrárselo a alguien del
equipo.

---

## Plataforma

Solo la ven los administradores de la plataforma, no los clientes. Lista las
empresas que usan la aplicación con lo que de verdad dice si activaron:
canales conectados, conocimiento cargado, leads, mensajes del último mes y
cuántos días llevan sin actividad.

La columna **Voz** muestra los minutos de llamadas del mes contra el tope de
cada empresa. **Cambiar** fija su tope mensual; `0` la deja sin llamadas.
Cuando se le acaban, su agente deja de ofrecer llamadas y sigue por texto.

La sección **Incidentes de proveedores** lista los abiertos y los cerrados de
los últimos 7 días, de todas las empresas y de la plataforma: canal, cuenta,
motivo, desde cuándo, duración, fallos y empresas afectadas.

**Crear demo** da de alta una cuenta vacía con su agente por defecto. Devuelve
el correo, la contraseña y el secreto de webhook **una sola vez**: cópialos
ahí mismo. Los leads y el conocimiento se cargan después desde el panel de esa
empresa, porque dependen de a quién se le vaya a mostrar.

Esta pantalla **no muestra conversaciones ni datos de los leads**: son
información personal de los clientes de cada empresa.

---

## Mi cuenta

Al pie del menú lateral, en tu correo.

- **Cambiar la contraseña**. Al cambiarla se cierran todas las demás sesiones
  abiertas con tu usuario; la actual sigue sin interrupción.
- Si la olvidaste, en la pantalla de acceso está **¿Olvidaste tu contraseña?**:
  llega un enlace por correo que vale **una hora**.

---

## Qué hace el agente por su cuenta

Para que sepas qué esperar sin tener que mirar el panel:

- **Responde** los mensajes entrantes. Espera unos segundos antes de contestar,
  a propósito: si el cliente manda tres mensajes seguidos, responde a todos
  juntos en vez de tres veces.
- **Hace seguimiento** de los leads que no responden, por la escalera de canales
  del agente, respetando el horario hábil, hasta el tope de intentos. Después
  cierra el lead como perdido.
- **Agenda citas** y envía recordatorios.
- **Escala a una persona** cuando no puede resolver algo, cuando el cliente lo
  pide, o cuando iba a decir una cifra que no puede respaldar. El lead queda
  pausado hasta que alguien devuelve el control.
- **Deriva a otro agente** si el tema es de su área, pasándole un resumen.
- **Respeta lo que pide el cliente**: si dice que no lo llamen, cancela la
  llamada agendada y no vuelve a ofrecerla.
