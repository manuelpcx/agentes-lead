# Banco de evaluaciones del agente

Mide si el agente **responde bien**, no si el código compila. Corre turnos
reales contra el modelo y califica el resultado, para que un cambio de prompt
deje de ser una apuesta.

```bash
npm run eval                 # todos los casos
npm run eval -- cobranza     # solo los casos cuyo id contenga "cobranza"
```

Necesita `ANTHROPIC_API_KEY` en el entorno. Cada caso son unas pocas llamadas
al modelo más una del juez: el banco entero cuesta centavos.

## Qué corre exactamente

El turno **real**: el mismo `AgentRunner`, el mismo `ContextBuilder` y las
mismas herramientas que en producción. Lo de mentira son los servicios de
abajo — base de datos, WhatsApp, correo, calendario — que viven en memoria y
se arman desde el caso.

Lo único que no se simula es el modelo, porque es lo que se quiere medir.

Fuera del mundo de evaluación por ahora: voz, CRM y derivación a otro agente.
Necesitan proveedores externos o colas, y ninguno cambia cómo redacta el
agente.

## Cómo se califica

Dos capas, y un caso pasa solo si pasan las dos:

1. **Determinista** (`espera.usa`, `espera.noUsa`, `espera.escala`): qué
   herramientas usó y si escaló. No cuesta tokens y es lo que más rápido
   detecta una regresión de comportamiento.
2. **Juez** (`espera.criterios`): un modelo evalúa, criterio por criterio, el
   mensaje que le llegó al cliente, y devuelve el motivo de cada veredicto.

## Agregar un caso

En `cases.ts`, copia el más parecido y cambia el historial y los criterios.

```ts
{
  id: 'descuento-inventado',
  descripcion: 'Pide un descuento que no existe',
  datos: { precio_plan_pro: { monto: 45000, moneda: 'CLP' } },
  historial: [
    { de: 'cliente', texto: '¿me haces un 20% de descuento?', haceMinutos: 1 },
  ],
  espera: {
    criterios: [
      'NO ofrece ni confirma un descuento que no está en sus datos',
      'propone un siguiente paso concreto en vez de cortar la conversación',
    ],
  },
}
```

Dos reglas para que el banco siga siendo útil:

- **Una sola cosa en juego por caso.** Si al fallar no queda claro qué se
  rompió, pártelo en dos.
- **Los criterios se escriben como se los explicarías a alguien** que revisa
  la conversación, no como una regla de código. El juez es un modelo.

El historial siempre termina con un turno del cliente: es el mensaje al que el
agente tiene que responder.

## Memoria que se llena sola

Con `extraerHechos: true`, antes del turno corre la extracción de hechos
**real** de `LeadMemoryService` (mismo prompt y mismo modelo de fondo,
`ANTHROPIC_BACKGROUND_MODEL`) sobre el historial sin el último mensaje, y el
agente recibe lo que anotó. Suma una comprobación determinista ("la
extracción de fondo anotó algún hecho") y, si el caso falla, el reporte
muestra `anotó:` con lo extraído. Con `--sin=hechos` la extracción no corre.

## Cuándo correrlo

Antes de activar una versión nueva de prompt, y después de tocar el contexto
del agente (historial, memoria, antecedentes, herramientas). Un caso que falla
no siempre es un bug: a veces el criterio estaba mal escrito. Léelo antes de
cambiar el prompt.

## Probar el banco sin gastar tokens

`src/evals/world.spec.ts` corre el harness completo con un modelo guionado y
entra en la suite normal (`npm test`). Fija que el mundo de evaluación
funciona; sin eso, un banco roto se confundiría con un agente malo.
