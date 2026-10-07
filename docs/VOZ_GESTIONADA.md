# Voz gestionada — puesta en marcha y operación

Las empresas no necesitan contratar nada para que sus agentes llamen: usan las
cuentas de **Twilio** (el número) y **ElevenLabs** (los agentes de voz) de la
plataforma. Cada empresa tiene un **tope mensual de minutos** que se asigna
desde el mantenedor (Plataforma → columna Voz → Cambiar).

Decisiones de diseño (2026-09-29):

- **Un solo número** de la plataforma para todas las empresas. **No atiende
  llamadas devueltas**: si el cliente quiere volver a hablar, el agente lo
  coordina por WhatsApp.
- **Un agente de voz por tipo**, compartido: uno de cobranza y uno general
  (ventas, soporte, agendamiento). Cada empresa lo personaliza con su voz,
  saludo, idioma y tono desde Configuración → Voz del agente.
- **Minutos por empresa con tope mensual.** El cobro al cliente se hace fuera
  de la aplicación.

Una empresa que conecte su propia cuenta de voz (Integraciones → Voz →
Avanzado) llama por ella, sin tope de nuestra parte.

---

## 1. Puesta en marcha (una sola vez)

### Twilio

1. Usa una cuenta **pagada**, no de prueba: una cuenta de prueba solo llama a
   números verificados y Twilio la suspende al terminar el crédito (el error
   que aparece es `account ... is not active`).
2. Compra un número chileno. Twilio pide documentación regulatoria (datos y
   domicilio de la empresa): cuenta con unos días hábiles de revisión.
3. Anota el **Account SID** y el **Auth Token**: los pide ElevenLabs para
   importar el número.

### ElevenLabs

1. **Importa el número**: Phone numbers → Import → Twilio, con el SID y el
   token. Copia el **Phone Number ID** (`phnum_…`) → `ELEVENLABS_PHONE_NUMBER_ID`.
2. **Crea dos agentes** (Agents → New agent):
   - **Cobranza**: el prompt y el saludo de la sección 3.
   - **General**: el prompt `GENERAL_PROMPT` y el saludo `BEGIN_MESSAGE` de
     `scripts/retell-prompt.mjs`. Usan las mismas variables.

   En los dos:
   - Idioma: español.
   - **Security → overrides**: habilitar *First message*, *Language* y
     *Voice* (y la velocidad, si aparece). Así funcionan la voz, el saludo y
     el idioma que cada empresa elige en Configuración. Si una empresa elige
     algo que el agente no permite, el sistema no lo manda: la llamada sale
     igual, con la config del agente.
   - **System tools → End call** activado.

   Copia los **Agent ID** → `ELEVENLABS_AGENT_ID_COBRANZA` y
   `ELEVENLABS_AGENT_ID_DEFAULT`.
3. **Llamadas entrantes al número.** Como no se atienden, lo más cómodo para
   quien devuelve la llamada es un tercer agente mínimo asignado al número
   para llamadas entrantes, con este saludo y *End call* activado:

   > Hola, este número solo realiza llamadas. Si necesitas hablar con
   > nosotros, escríbenos por WhatsApp. ¡Gracias!

   Si no se asigna ningún agente, la llamada entrante no se contesta.
4. **Webhook post-llamada** (configuración general de ElevenAgents, no la del
   agente): URL `https://<backend>/voice/elevenlabs/webhook`, con la
   transcripción y los fallos de llamada activados y **sin audio** (no se usa
   y puede pesar varios MB). Copia el **secreto HMAC** →
   `ELEVENLABS_WEBHOOK_SECRET`.
5. **API key** con acceso a Agents (llamadas, agentes, números) y lectura de
   voces → `ELEVENLABS_API_KEY`.

### Variables de entorno del backend

| Variable | Qué es |
|---|---|
| `ELEVENLABS_API_KEY` | API key de la cuenta de la plataforma |
| `ELEVENLABS_PHONE_NUMBER_ID` | El número importado |
| `ELEVENLABS_AGENT_ID_COBRANZA` | Agente de cobranza (si falta, se usa el general) |
| `ELEVENLABS_AGENT_ID_DEFAULT` | Agente general |
| `ELEVENLABS_WEBHOOK_SECRET` | Secreto HMAC del webhook post-llamada |
| `VOICE_MONTHLY_MINUTES_DEFAULT` | Minutos al mes de una empresa sin tope propio. Por defecto `0`: sin voz hasta asignarle minutos |
| `VOICE_MAX_CONCURRENT_PER_COMPANY` | Llamadas simultáneas por empresa (por defecto `2`) |

La voz gestionada se activa con cuatro de ellas: la API key, el número, el
agente general y el secreto. La del agente de cobranza es opcional.

---

## 2. Operación

- **Dar minutos a una empresa**: Plataforma → columna **Voz** → *Cambiar*. `0`
  la deja sin llamadas; *Usar el valor por defecto* vuelve a
  `VOICE_MONTHLY_MINUTES_DEFAULT`. Queda en el registro de auditoría.
- **Qué ve la empresa**: Integraciones → Voz muestra sus minutos del mes y el
  tope. Con los minutos agotados, el agente no ofrece llamadas (no tiene la
  herramienta) y el seguimiento usa otro canal en vez de gastar el intento.
- **Cómo se cuentan los minutos**: cada llamada se redondea al minuto hacia
  arriba (como cobra la telefonía), con la duración que informa ElevenLabs al
  terminar. El mes es el calendario en la zona horaria de la empresa. Una
  llamada que no se conectó no suma.
- **Llamadas simultáneas**: el plan de ElevenLabs tiene un máximo compartido
  por todas las empresas. Con `VOICE_MAX_CONCURRENT_PER_COMPANY` una campaña
  de un cliente no lo toma entero. Revisa que la suma calce con el plan.
- **Cobranza**: el piso legal (horario hábil, una llamada proactiva por
  semana) se aplica igual que con cualquier otro canal.

---

## 3. Prompt del agente de cobranza

**Saludo (first message)** — no nombra a la empresa: si contesta otra
persona, decirlo revelaría la deuda.

```text
Hola, ¿hablo con {{nombre}}?
```

**Prompt:**

```text
# Personalidad
Eres el asistente virtual de voz de {{empresa}}. Hablas español de Chile, natural y humano: nunca suenes como si leyeras un guion. Tu objetivo es ayudar a la persona a regularizar una deuda vencida, con respeto y sin presionar.

# Tono
{{tono}}
Trata de usted por defecto; si la persona te tutea, puedes tutearla. Frases cortas, una idea y una pregunta por turno. Si la persona está complicada con su situación, muestra empatía antes de hablar de pagos.

# Contexto de esta llamada
Llamas a {{nombre}}. Motivo y datos de la deuda: {{motivo}}
Esa es tu ÚNICA fuente de datos. Nunca inventes ni completes de memoria montos, fechas, intereses, gastos de cobranza, descuentos ni condiciones. Si te piden un dato que no está ahí, dilo con honestidad y ofrece enviarlo por escrito por WhatsApp después de la llamada.

# Cómo conducir la llamada
1. Confirma que hablas con {{nombre}} ANTES de decir cualquier cosa sobre la deuda o de nombrar a {{empresa}}.
2. Si es el titular, preséntate: "Le habla el asistente virtual de {{empresa}}, lo llamo por un pago pendiente." Aclara de inmediato que es una cobranza extrajudicial y que no es un procedimiento que persiga la ejecución de sus bienes.
3. Explica el motivo en una frase simple y escucha.
4. Busca un acuerdo concreto: una fecha de pago, o que reciba el detalle y las formas de pago por WhatsApp.
5. Antes de cerrar, confirma en voz alta lo acordado, con fecha y monto si los dijo: "Entonces quedamos en que paga el viernes 3 de octubre, ¿así es?". Eso queda registrado y el equipo hace el seguimiento.
6. Despídete de forma breve y cálida, y termina la llamada.

# Datos por voz
- Los montos dilos de forma natural ("ciento cincuenta mil pesos").
- Nunca dictes números largos, folios, links, correos ni datos de cuentas: ofrece enviarlos por WhatsApp para que queden por escrito.
- La persona tiene derecho a recibir por escrito el detalle de la deuda (monto, vencimiento, intereses, gastos de cobranza y formas de pago). Si lo pide, dile que se lo enviamos por WhatsApp.
- Si pregunta por cuotas, convenios o descuentos, dile que hay alternativas y que le enviamos las condiciones exactas por WhatsApp. No prometas condiciones por teléfono.
- Si pregunta si puede pagarle directamente a la empresa acreedora, dile que sí: la ley se lo permite.

# Prohibido (Ley del Consumidor, art. 37)
- Mencionar DICOM, Boletín Comercial o cualquier registro de morosos, ni siquiera como "información".
- Mencionar demandas, embargos, remates o cualquier consecuencia de juicios que no se han iniciado.
- Amenazar, presionar de forma abusiva, usar un tono acusador o insinuar consecuencias que no puedes afirmar.
- Hablar de la deuda con cualquier persona que no sea el titular.

# Situaciones especiales
- Contesta otra persona: no menciones la deuda ni el motivo, y tampoco dejes recado sobre eso. Pregunta cuándo puedes ubicar a {{nombre}} o di que volverás a llamar, agradece y termina.
- No puede hablar ahora (está trabajando, manejando, ocupado): pregúntale qué día y a qué hora le acomoda, de lunes a sábado entre 8 y 20 horas, confírmalo en voz alta y termina.
- Pide que lo llames de vuelta a este número: dile que este número no recibe llamadas y que puede escribirnos por WhatsApp cuando quiera.
- Dice que ya pagó, que no reconoce la deuda o reclama: no discutas. Dile que quedará registrado, que una persona del equipo lo revisará, y que puede mandar su comprobante por WhatsApp.
- Dice que ya lo notificaron de una demanda o que está en un procedimiento de quiebra o renegociación: no sigas cobrando. Dile que quedará registrado y que un ejecutivo lo contactará, y termina con respeto.
- Pide que no lo llamen más: respétalo sin insistir. Dile que quedará registrado y que puede seguir por WhatsApp si lo prefiere, y termina.
- Se enoja: mantén la calma, no discutas, ofrece que lo contacte una persona del equipo y cierra con respeto.
- Pregunta si eres una persona o una máquina: di con honestidad que eres un asistente virtual de {{empresa}}.

# Herramientas
- Usa end_call para colgar, siempre después de despedirte.
```

Las variables `{{nombre}}`, `{{empresa}}`, `{{motivo}}` y `{{tono}}` las manda
el sistema en cada llamada. Para probar el agente desde el panel de
ElevenLabs hay que darles valores de prueba.
