# Alertas de proveedores — plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar el plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el responsable de una cuenta (el dueño de la empresa, o los administradores de la plataforma) se entere apenas un proveedor de WhatsApp, correo, voz o IA deja de funcionar. Se avisa con un aviso en el panel y un correo, y el aviso se cierra solo cuando el proveedor se recupera.

**Arquitectura:**
- **Detección.** Un `ProviderHealthService` envuelve cada envío en los 4 puntos únicos de salida (`WhatsappService`, `EmailService`, `VoiceService`, `AnthropicService`) y anota si funcionó, sin cambiar el resultado. Los fallos se clasifican en cuenta, pasajero o del mensaje (`classifyProviderError`).
- **Incidentes.** Viven en la tabla `ProviderIncident`, con un único incidente abierto por clave gracias a `openKey @unique`. Se abren al primer error de cuenta o a los 3 errores pasajeros seguidos, y se cierran con el primer éxito.
- **Avisos.** `IncidentNotifier` manda los correos por `PlatformEmailService`. El panel consulta `GET /panel/alerts` y Plataforma consulta `GET /platform/incidents`.

**Tecnologías:** NestJS 10, Prisma 5 (Postgres), ioredis (`REDIS_CLIENT`), Jest; React 18 + Vite + Tailwind, react-i18next, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-10-08-alertas-proveedores-design.md`

## Restricciones globales

- **No hacer commit ni deploy.** El usuario lo pidió explícitamente ("No commitear ni desplegar sin que el usuario lo pida"). Los pasos de commit del formato estándar se reemplazan por un **checkpoint de verificación**.
- **Idioma:** código, comentarios y mensajes en español. Todo texto visible del frontend va en `frontend/src/i18n/locales/es.json` **y** `en.json`.
- **Umbrales** (constantes, no variables de entorno):
  - Pasajeros: **3 fallos seguidos dentro de 15 min**.
  - Correos de apertura: **como máximo 1 cada 6 h** por clave.
  - Aviso del panel: se refresca **cada 60 s**.
- **El registro nunca demora ni rompe un envío.** `observe` devuelve lo mismo o relanza el mismo error; el registro corre en segundo plano y sus errores solo van al log.
- **Aislamiento entre empresas:**
  - `ProviderIncident` se consulta **solo por `prisma.raw`**, con `companyId` explícito.
  - Va en `EXENTOS` de `tenant-coverage.spec.ts`, con su motivo.
  - Un usuario normal **nunca** recibe `provider`, `reason` ni `hint` de un incidente de plataforma.
- **Comandos:**
  - Backend: `npx jest <ruta>`, `npm run build`, `npx eslint <rutas>`.
  - Frontend: `pnpm build` dentro de `frontend/`. El lint del frontend no corre: eslint no está instalado ahí, es un problema previo.
- **Ajuste respecto del spec, ya acordado al planificar:**
  - "Hay incidente abierto" y el límite de correos se resuelven en la base de datos (búsqueda por `openKey` y por `key`, ambas indexadas). Redis queda **solo** para la racha de fallos pasajeros: menos estado duplicado y menos casos raros.
  - El enlace de los correos usa la misma URL del panel que el correo de "recuperar contraseña" (`PANEL_URL`, si no `CORS_ORIGIN`, si no `localhost`), mediante un helper compartido.

## Puntos a revisar

Casos que el spec implica y que conviene fijar con un test en la tarea que los cubre:

1. **Importación grande con teléfonos inválidos:** decenas de errores 400 seguidos **no** deben abrir un incidente. → Tarea 5, test "muchos errores del mensaje no abren nada".
2. **El proveedor se recupera y vuelve a caer antes de 6 h:** se abre otro incidente (y otro aviso en el panel), pero **sin** un segundo correo. → Tarea 4, test del límite de 6 h.
3. **La IA falla en un proceso sin empresa** (el análisis nocturno no tiene contexto de empresa): el incidente se abre igual, con `affectedCompanyIds = []`. Los administradores lo ven y ninguna empresa recibe un aviso. → Tarea 5, test "plataforma sin empresa en contexto".
4. **Empresa sin ningún OWNER** (solo operadores): no hay correo, pero el aviso del panel aparece. Como nunca se avisó la apertura, el cierre tampoco manda correo. → Tarea 4, test "sin destinatarios".
5. **El frontend se despliega antes que el backend** (Vercel antes que Railway) y `/panel/alerts` responde 404: el panel no muestra nada ni rompe. → Tarea 10, revisión en el navegador con el servidor de prueba respondiendo 404.

---

## Mapa de archivos

**Crear (backend, `src/alerts/`):**
- `provider-error.ts`: `ProviderError` y `classifyProviderError` (puro).
- `alerts.types.ts`: `HealthTarget`, `incidentKey`, `providerLabel`.
- `incident-email.ts`: textos de los correos (puro).
- `incident-notifier.service.ts`: destinatarios, límite de 6 h y envío.
- `provider-health.service.ts`: `observe`, `success`, `failure`.
- `alerts-query.service.ts`: lecturas para el panel y para Plataforma.
- `panel-alerts.controller.ts`: `GET /panel/alerts`.
- `alerts.module.ts`: global.
- Specs junto a cada archivo, más `provider-throw-sites.spec.ts`.

**Crear (otros):**
- `src/common/config/panel-url.ts`.
- `prisma/migrations/20261008120000_provider_incidents/migration.sql`.
- `src/whatsapp/whatsapp.service.spec.ts` y `src/llm/anthropic.service.spec.ts`.
- `frontend/src/components/ProviderAlerts.tsx` y `frontend/src/components/IncidentsCard.tsx`.

**Modificar:**
- **Prisma y aislamiento:** `prisma/schema.prisma`, `src/common/prisma/tenant-coverage.spec.ts`.
- **Proveedores:**
  - `src/whatsapp/providers/send-error.ts` y su spec.
  - `src/email/providers/resend.provider.ts`.
  - `src/voice/providers/{vapi,retell,elevenlabs}.provider.ts`.
- **Los 4 puntos de envío:**
  - `src/whatsapp/whatsapp.service.ts`.
  - `src/email/email.service.ts` y su spec.
  - `src/voice/voice.service.ts` y su spec.
  - `src/llm/anthropic.service.ts`.
- **Cableado y endpoints:** `src/auth/auth.service.ts`, `src/app.module.ts`, `src/platform/platform.controller.ts`.
- **Frontend:**
  - `frontend/src/types.ts`.
  - `frontend/src/components/AppLayout.tsx`.
  - `frontend/src/pages/PlatformPage.tsx`.
  - `frontend/src/i18n/locales/{es,en}.json`.
- **Documentación:** `docs/DESPLIEGUE.md`, `docs/PANEL.md`, `docs/PANEL.en.md`.

---

### Tarea 1: Clasificador de errores de proveedor

**Archivos:**
- Crear: `src/alerts/provider-error.ts`
- Test: `src/alerts/provider-error.spec.ts`

**Interfaces:**
- Produce:
  - `class ProviderError extends Error { status?: number; code?: string }`, con constructor `(message, status?, code?)`.
  - `type ProviderErrorKind = 'account' | 'transient' | 'request'`.
  - `interface ProviderErrorClass { kind; reason: string; hint?: string }`.
  - `classifyProviderError(error: unknown, providerLabel: string): ProviderErrorClass`.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// src/alerts/provider-error.spec.ts
import { ProviderError, classifyProviderError } from './provider-error';

describe('classifyProviderError', () => {
  it('YCloud sin saldo: cuenta, con motivo y qué hacer', () => {
    const e = new ProviderError(
      'Fallo al enviar WhatsApp (YCloud 403: la cuenta de YCloud no tiene saldo)',
      403,
      'BALANCE_INSUFFICIENT',
    );
    expect(classifyProviderError(e, 'YCloud')).toEqual({
      kind: 'account',
      reason: 'La cuenta de YCloud no tiene saldo.',
      hint: 'Recarga saldo en YCloud.',
    });
  });

  it('Twilio suspendido, reenviado por ElevenLabs dentro de un 400: cuenta', () => {
    const e = new Error(
      'Fallo al iniciar la llamada (ElevenLabs 400): HTTP 401 error: Unable to ' +
        'create record: authentication failed, account AC377 with status 4 is not active',
    );
    expect(classifyProviderError(e, 'ElevenLabs')).toMatchObject({
      kind: 'account',
      reason: 'La cuenta de Twilio está suspendida o inactiva.',
    });
  });

  it('Anthropic sin crédito (error del SDK con status): cuenta', () => {
    const e = Object.assign(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      ),
      { status: 400 },
    );
    expect(classifyProviderError(e, 'Anthropic')).toMatchObject({
      kind: 'account',
      reason: 'La cuenta de Anthropic no tiene crédito.',
    });
  });

  it('401 sin texto conocido: cuenta (clave rechazada)', () => {
    const e = new ProviderError('Fallo al enviar correo (Resend 401)', 401);
    expect(classifyProviderError(e, 'Resend')).toMatchObject({
      kind: 'account',
      reason: 'Resend rechazó la clave de acceso.',
    });
  });

  it('SMTP con usuario o contraseña inválidos (EAUTH): cuenta', () => {
    const e = Object.assign(new Error('Invalid login: 535'), { code: 'EAUTH' });
    expect(classifyProviderError(e, 'SMTP').kind).toBe('account');
  });

  it.each([
    [new ProviderError('Fallo (YCloud 500)', 500), 'transient'],
    [new ProviderError('Fallo (Vapi 429)', 429), 'transient'],
    [new Error('Fallo al iniciar la llamada (Vapi 503)'), 'transient'],
    [new TypeError('fetch failed'), 'transient'],
    [Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }), 'transient'],
    [Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }), 'transient'],
  ])('%s → %s', (error, kind) => {
    expect(classifyProviderError(error, 'X').kind).toBe(kind);
  });

  it('teléfono inválido (400): es del mensaje, no del proveedor', () => {
    const e = new ProviderError(
      'Fallo al enviar WhatsApp (YCloud 400: Invalid phone number)',
      400,
    );
    expect(classifyProviderError(e, 'YCloud').kind).toBe('request');
  });

  it('error sin señales (puede ser nuestro): no culpa al proveedor', () => {
    expect(
      classifyProviderError(
        new Error('Anthropic no está configurado (falta ANTHROPIC_API_KEY)'),
        'Anthropic',
      ).kind,
    ).toBe('request');
    expect(classifyProviderError('texto suelto', 'X').kind).toBe('request');
  });
});
```

- [ ] **Paso 2: Correr el test y verificar que falla**

Correr: `npx jest src/alerts/provider-error.spec.ts`
Esperado: FALLA con "Cannot find module './provider-error'".

- [ ] **Paso 3: Implementar**

```ts
// src/alerts/provider-error.ts
/** Qué tan grave es un fallo de un proveedor externo. */
export type ProviderErrorKind = 'account' | 'transient' | 'request';

/**
 * Error de un proveedor externo (WhatsApp, correo, voz) con el código HTTP y
 * el código propio del proveedor. El mensaje es el legible de siempre; los
 * códigos sirven para clasificar el fallo sin adivinar por el texto.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderErrorClass {
  kind: ProviderErrorKind;
  /** Motivo legible para la persona. */
  reason: string;
  /** Qué hacer, si se sabe. */
  hint?: string;
}

/**
 * Señales de un problema de la CUENTA en el texto o el código del error. Van
 * antes que el código HTTP: ElevenLabs, por ejemplo, devuelve el rechazo de
 * Twilio dentro de una respuesta 4xx genérica. El orden importa: de lo más
 * específico a lo más general.
 */
const ACCOUNT_SIGNALS: Array<{
  re: RegExp;
  reason: (p: string) => string;
  hint: (p: string) => string;
}> = [
  {
    re: /BALANCE_INSUFFICIENT|balance is insufficient/i,
    reason: (p) => `La cuenta de ${p} no tiene saldo.`,
    hint: (p) => `Recarga saldo en ${p}.`,
  },
  {
    re: /credit balance is too low/i,
    reason: (p) => `La cuenta de ${p} no tiene crédito.`,
    hint: (p) => `Recarga crédito en ${p}.`,
  },
  {
    re: /account \S+ with status \S+ is not active/i,
    reason: () => 'La cuenta de Twilio está suspendida o inactiva.',
    hint: () => 'Revisa el estado y la facturación de la cuenta de Twilio.',
  },
  {
    re: /not active|suspended|deactivated/i,
    reason: (p) => `La cuenta de ${p} está suspendida o inactiva.`,
    hint: (p) => `Revisa el estado de la cuenta en ${p}.`,
  },
  {
    re: /quota|insufficient/i,
    reason: (p) => `La cuenta de ${p} llegó a su límite.`,
    hint: (p) => `Revisa el plan y el consumo en ${p}.`,
  },
];

/** Códigos de red (Node, nodemailer) que indican que no se pudo conectar. */
const NETWORK_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKET',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * Clasifica un fallo de un proveedor:
 *  - `account`: problema de la cuenta (saldo, clave, suspensión). Abre un
 *    incidente al primer fallo.
 *  - `transient`: el proveedor está caído o limitando. Abre tras varios
 *    fallos seguidos.
 *  - `request`: problema de ese envío en particular (teléfono inválido…), o
 *    un error sin señales que puede ser nuestro. No culpa al proveedor.
 * Acepta cualquier error: si no es `ProviderError`, lee `status` del objeto
 * (SDK de Anthropic) o del texto ("(Vapi 503)").
 */
export function classifyProviderError(
  error: unknown,
  providerLabel: string,
): ProviderErrorClass {
  const p = providerLabel;
  const e = (error ?? {}) as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const message = typeof e.message === 'string' ? e.message : String(error);
  const code = typeof e.code === 'string' ? e.code : '';
  const haystack = `${code} ${message}`;

  for (const signal of ACCOUNT_SIGNALS) {
    if (signal.re.test(haystack)) {
      return { kind: 'account', reason: signal.reason(p), hint: signal.hint(p) };
    }
  }
  if (code === 'EAUTH') {
    return {
      kind: 'account',
      reason: `${p} rechazó el usuario o la contraseña.`,
      hint: `Revisa las credenciales de ${p}.`,
    };
  }

  const status =
    typeof e.status === 'number' ? e.status : statusFromMessage(message);
  if (status === 401) {
    return {
      kind: 'account',
      reason: `${p} rechazó la clave de acceso.`,
      hint: `Revisa la clave configurada para ${p}.`,
    };
  }
  if (status === 402) {
    return {
      kind: 'account',
      reason: `La cuenta de ${p} tiene un problema de pago.`,
      hint: `Revisa la facturación en ${p}.`,
    };
  }
  if (status === 403) {
    return {
      kind: 'account',
      reason: `${p} rechazó el envío por un problema de la cuenta.`,
      hint: `Revisa el estado de la cuenta en ${p}.`,
    };
  }
  if (status === 429) {
    return {
      kind: 'transient',
      reason: `${p} está limitando los envíos por exceso de solicitudes.`,
    };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'transient', reason: `${p} está fallando (error ${status}).` };
  }
  if (status !== undefined && status >= 400) {
    return { kind: 'request', reason: message };
  }

  if (
    NETWORK_CODES.has(code) ||
    e.name === 'APIConnectionError' ||
    e.name === 'APIConnectionTimeoutError' ||
    /fetch failed|connection error|timed? ?out|socket hang up/i.test(message)
  ) {
    return { kind: 'transient', reason: `No se pudo conectar con ${p}.` };
  }
  return { kind: 'request', reason: message };
}

/** "(YCloud 403: …)" o "(ElevenLabs 400 al leer …)" → 403 / 400. */
function statusFromMessage(message: string): number | undefined {
  const m = /\((?:[A-Za-z]+ )?([1-5]\d\d)\b/.exec(message);
  return m ? Number(m[1]) : undefined;
}
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

Correr: `npx jest src/alerts/provider-error.spec.ts`
Esperado: PASA (todos los casos).

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/alerts/provider-error.ts src/alerts/provider-error.spec.ts`
Esperado: sin errores.

---

### Tarea 2: Los proveedores lanzan `ProviderError`

**Archivos:**
- Modificar:
  - `src/whatsapp/providers/send-error.ts` (todo el archivo).
  - `src/email/providers/resend.provider.ts:37-43`.
  - `src/voice/providers/vapi.provider.ts:37-43`.
  - `src/voice/providers/retell.provider.ts:72-83`.
  - `src/voice/providers/elevenlabs.provider.ts`: los 3 `throw` de `startCall` y `outboundPath`.
- Test:
  - `src/whatsapp/providers/send-error.spec.ts`: agregar un caso.
  - Crear `src/alerts/provider-throw-sites.spec.ts`.

**Interfaces:**
- Consume: `ProviderError` (Tarea 1).
- Produce: `whatsappSendError(provider, status, detail): ProviderError`. Los mensajes **no cambian**.

- [ ] **Paso 1: Escribir los tests que fallan**

Agregar al final del `describe` de `src/whatsapp/providers/send-error.spec.ts`:

```ts
  it('devuelve un ProviderError con el código HTTP y el del proveedor', () => {
    const body = JSON.stringify({
      error: { status: 403, code: 'BALANCE_INSUFFICIENT', message: 'x' },
    });
    const e = whatsappSendError('YCloud', 403, body);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ status: 403, code: 'BALANCE_INSUFFICIENT' });
  });
```

Con el import `import { ProviderError } from '../../alerts/provider-error';` arriba del archivo.

Crear `src/alerts/provider-throw-sites.spec.ts`:

```ts
import { ProviderError } from './provider-error';
import { ResendEmailProvider } from '../email/providers/resend.provider';
import { VapiVoiceProvider } from '../voice/providers/vapi.provider';
import { RetellVoiceProvider } from '../voice/providers/retell.provider';
import {
  ElevenLabsVoiceProvider,
  resetElevenLabsCache,
} from '../voice/providers/elevenlabs.provider';

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

const CALL = { to: '+56911111111', metadata: { leadId: 'lead-1' } };

describe('los proveedores lanzan ProviderError con el código HTTP', () => {
  beforeEach(() => resetElevenLabsCache());

  it('Resend: estado y nombre del error, mensaje de siempre', async () => {
    mockFetch(403, { statusCode: 403, name: 'validation_error', message: 'x' });
    const err = await new ResendEmailProvider('re_x', 'a@b.cl')
      .send({ to: 'c@d.cl', subject: 's', text: 't' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      status: 403,
      code: 'validation_error',
      message: 'Fallo al enviar correo (Resend 403)',
    });
  });

  it('Vapi', async () => {
    mockFetch(503, {});
    const err = await new VapiVoiceProvider({ apiKey: 'k' })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      status: 503,
      message: 'Fallo al iniciar la llamada (Vapi 503)',
    });
  });

  it('Retell', async () => {
    mockFetch(401, { error: 'bad key' });
    const err = await new RetellVoiceProvider({
      apiKey: 'k',
      fromNumber: '+56900000000',
    })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401 });
    expect((err as Error).message).toContain('(Retell 401)');
  });

  it('ElevenLabs, al leer el número de teléfono', async () => {
    mockFetch(401, { detail: 'invalid api key' });
    const err = await new ElevenLabsVoiceProvider({
      apiKey: 'k',
      agentId: 'agent',
      phoneNumberId: 'phnum',
    })
      .startCall(CALL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401 });
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npx jest src/alerts/provider-throw-sites.spec.ts src/whatsapp/providers/send-error.spec.ts`
Esperado: FALLA. `toBeInstanceOf(ProviderError)` no se cumple: hoy los proveedores lanzan `Error`.

- [ ] **Paso 3: Implementar**

`src/whatsapp/providers/send-error.ts`: reemplazar `whatsappSendError` y `readReason` por:

```ts
import { ProviderError } from '../../alerts/provider-error';

// (KNOWN_REASONS queda igual)

/**
 * Error de envío con el motivo que dio el proveedor. Antes solo llevaba el
 * código HTTP ("YCloud 403"), y en el panel no había forma de saber que el
 * problema era, por ejemplo, la falta de saldo. Lleva además el código HTTP y
 * el del proveedor, para clasificar el fallo (alertas de proveedores).
 */
export function whatsappSendError(
  provider: 'YCloud' | 'Meta',
  status: number,
  detail: string,
): ProviderError {
  const { reason, code } = readReason(detail);
  return new ProviderError(
    `Fallo al enviar WhatsApp (${provider} ${status}${reason ? `: ${reason}` : ''})`,
    status,
    code,
  );
}

/** Lee `{ error: { code, message } }`, el formato de YCloud y de Meta. */
function readReason(detail: string): { reason: string | null; code?: string } {
  let body: unknown;
  try {
    body = JSON.parse(detail);
  } catch {
    return { reason: null };
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } })
    ?.error;
  if (!error) return { reason: null };
  const code =
    typeof error.code === 'string' || typeof error.code === 'number'
      ? String(error.code)
      : undefined;
  if (typeof error.code === 'string' && KNOWN_REASONS[error.code]) {
    return { reason: KNOWN_REASONS[error.code], code };
  }
  const message =
    typeof error.message === 'string' ? error.message.trim() : '';
  return { reason: message ? message.slice(0, 200) : null, code };
}
```

`src/email/providers/resend.provider.ts`: importar `import { ProviderError } from '../../alerts/provider-error';` y cambiar el `throw`:

```ts
      throw new ProviderError(
        `Fallo al enviar correo (Resend ${response.status})`,
        response.status,
        errorName(detail),
      );
```

y agregar al final del archivo:

```ts
/** `name` del error de Resend (ej. "validation_error"), si viene. */
function errorName(detail: string): string | undefined {
  try {
    const body = JSON.parse(detail) as { name?: unknown };
    return typeof body.name === 'string' ? body.name : undefined;
  } catch {
    return undefined;
  }
}
```

`src/voice/providers/vapi.provider.ts`: importar `ProviderError` (`'../../alerts/provider-error'`) y:

```ts
      throw new ProviderError(
        `Fallo al iniciar la llamada (Vapi ${response.status})`,
        response.status,
      );
```

`src/voice/providers/retell.provider.ts`: importar `ProviderError` y:

```ts
      throw new ProviderError(
        `Fallo al iniciar la llamada (Retell ${response.status}): ${detail.slice(0, 300) || '(sin detalle)'}`,
        response.status,
      );
```

`src/voice/providers/elevenlabs.provider.ts`: importar `ProviderError` y cambiar 3 `throw` (los mensajes quedan iguales):

```ts
      // startCall, respuesta no ok:
      throw new ProviderError(
        `Fallo al iniciar la llamada (ElevenLabs ${response.status}): ` +
          `${detail.slice(0, 300) || '(sin detalle)'}`,
        response.status,
      );
```

```ts
    // startCall, success === false (sin código HTTP; el texto puede traer
    // el rechazo de Twilio y el clasificador lo reconoce):
    if (json.success === false) {
      throw new ProviderError(
        `Fallo al iniciar la llamada (ElevenLabs): ${json.message ?? '(sin detalle)'}`,
      );
    }
```

```ts
      // outboundPath, al leer el número:
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new ProviderError(
          `Fallo al iniciar la llamada (ElevenLabs ${res.status} al leer el ` +
            `número ${id}): ${detail.slice(0, 200) || '(sin detalle)'}`,
          res.status,
        );
      }
```

El `throw` de "el número … es de tipo … solo se puede llamar desde números Twilio o SIP trunk" queda como `Error`: es un error de configuración, no del proveedor.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Correr: `npx jest src/alerts src/whatsapp/providers src/voice src/email`
Esperado: PASA, incluidas las specs que ya existían de ElevenLabs, voz y correo: los mensajes no cambiaron.

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/alerts src/whatsapp/providers src/email/providers src/voice/providers`
Esperado: sin errores.

---

### Tarea 3: Tabla `ProviderIncident` y migración

**Archivos:**
- Modificar:
  - `prisma/schema.prisma`: modelo nuevo más la relación en `Company`.
  - `src/common/prisma/tenant-coverage.spec.ts`: `EXENTOS`.
- Crear: `prisma/migrations/20261008120000_provider_incidents/migration.sql`

**Interfaces:**
- Produce: el modelo Prisma `ProviderIncident` (tipo `ProviderIncident` de `@prisma/client`) con los campos `id, companyId, scope, service, provider, kind, reason, hint, failureCount, affectedCompanyIds, openedAt, lastFailureAt, resolvedAt, openNotifiedAt, key, openKey`.

- [ ] **Paso 1: Agregar el modelo (esto hace fallar la cobertura de aislamiento)**

En `prisma/schema.prisma`, al final:

```prisma
/// Incidente de un proveedor externo (WhatsApp, correo, voz, IA): se abre
/// cuando los envíos por una cuenta empiezan a fallar y se cierra con el
/// primer envío exitoso. Ver `src/alerts/`.
model ProviderIncident {
  id                 String    @id @default(uuid()) @db.Uuid
  /// Empresa dueña de la cuenta; null = cuenta de la plataforma.
  companyId          String?   @db.Uuid
  scope              String
  service            String
  provider           String
  kind               String
  reason             String
  hint               String?
  failureCount       Int       @default(1)
  /// Empresas que sufrieron el incidente (relevante en los de plataforma).
  affectedCompanyIds String[]  @db.Uuid
  openedAt           DateTime  @default(now())
  lastFailureAt      DateTime  @default(now())
  resolvedAt         DateTime?
  openNotifiedAt     DateTime?
  /// Clave permanente (empresa o plataforma + canal + proveedor).
  key                String
  /// Copia de `key` mientras está abierto; null al cerrarse. Único: un solo
  /// incidente abierto por clave (Postgres permite varios NULL).
  openKey            String?   @unique

  company Company? @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, resolvedAt])
  @@index([resolvedAt])
  @@index([key, openedAt])
}
```

En `model Company`, junto a `voiceCalls VoiceCall[]`:

```prisma
  providerIncidents  ProviderIncident[]
```

- [ ] **Paso 2: Verificar que la cobertura de aislamiento falla**

Correr: `npx jest src/common/prisma/tenant-coverage.spec.ts`
Esperado: FALLA ("todo modelo con companyId está en TENANT_SCOPED_MODELS o exento con motivo"), con `ProviderIncident` en la lista.

- [ ] **Paso 3: Exentarlo con su motivo**

En `EXENTOS` de `src/common/prisma/tenant-coverage.spec.ts`:

```ts
  // Alertas de proveedores: companyId es opcional (null = cuenta de la
  // plataforma, que afecta a todas). Se consulta solo por raw y cada lectura
  // del panel filtra explícitamente por la empresa activa.
  ProviderIncident:
    'companyId opcional (null = plataforma); consultado por raw con companyId explícito',
```

- [ ] **Paso 4: Generar la migración sin base de datos y el cliente**

```bash
git show HEAD:prisma/schema.prisma > "$TMPDIR/schema-antes.prisma"
mkdir -p prisma/migrations/20261008120000_provider_incidents
npx prisma migrate diff --from-schema-datamodel "$TMPDIR/schema-antes.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261008120000_provider_incidents/migration.sql
npx prisma generate
```

Anteponer al `migration.sql` el comentario:

```sql
-- Alertas de proveedores: un incidente por cuenta (de una empresa o de la
-- plataforma) con problemas, abierto hasta el primer envío exitoso.
```

El SQL generado debe contener: `CREATE TABLE "ProviderIncident"` con `"companyId" UUID` (sin `NOT NULL`) y `"affectedCompanyIds" UUID[]`; `CREATE UNIQUE INDEX "ProviderIncident_openKey_key"`; los 3 índices; y la FK `ON DELETE CASCADE` a `"Company"`. No debe tocar otras tablas: si aparece algo más, el `HEAD` no estaba al día con la base de datos y hay que avisar.

- [ ] **Paso 5: Correr y verificar**

Correr: `npx jest src/common/prisma/tenant-coverage.spec.ts && npm run build`
Esperado: PASA y el build termina sin errores.

---

### Tarea 4: Correos de incidentes (`IncidentNotifier`) y URL del panel compartida

**Archivos:**
- Crear:
  - `src/alerts/alerts.types.ts`
  - `src/alerts/incident-email.ts`
  - `src/alerts/incident-notifier.service.ts`
  - `src/common/config/panel-url.ts`
- Modificar: `src/auth/auth.service.ts:66-70`, para usar `resolvePanelUrl`.
- Test:
  - `src/alerts/incident-email.spec.ts`
  - `src/alerts/incident-notifier.service.spec.ts`

**Interfaces:**
- Consume: el modelo `ProviderIncident` (Tarea 3); `PlatformEmailService.send({ to, subject, text })`.
- Produce:
  - `type AlertService = 'whatsapp' | 'email' | 'voice' | 'llm'` y `type AlertScope = 'company' | 'platform'`.
  - `interface HealthTarget { service: AlertService; provider: string; scope: AlertScope; companyId?: string }`.
  - `incidentKey(t: HealthTarget): string` y `providerLabel(provider: string): string`.
  - `resolvePanelUrl(config): string`.
  - `IncidentNotifier.opened(incident: ProviderIncident, now?: Date): Promise<boolean>`.
  - `IncidentNotifier.resolved(incident: ProviderIncident, now?: Date): Promise<void>`.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// src/alerts/incident-email.spec.ts
import type { ProviderIncident } from '@prisma/client';
import { formatDuration, openedEmail, resolvedEmail } from './incident-email';

const INC = {
  id: 'i1',
  companyId: 'c1',
  scope: 'company',
  service: 'whatsapp',
  provider: 'ycloud',
  kind: 'account',
  reason: 'La cuenta de YCloud no tiene saldo.',
  hint: 'Recarga saldo en YCloud.',
  failureCount: 14,
  affectedCompanyIds: ['c1'],
  openedAt: new Date('2026-10-06T19:30:00Z'),
  lastFailureAt: new Date('2026-10-06T21:30:00Z'),
  resolvedAt: null,
  openNotifiedAt: null,
  key: 'company:c1:whatsapp:ycloud',
  openKey: 'company:c1:whatsapp:ycloud',
} as ProviderIncident;

describe('correos de incidentes', () => {
  it('apertura: asunto con canal y empresa, motivo, qué hacer y enlace', () => {
    const m = openedEmail(INC, 'Cobranzas del Sur', 'https://panel.x/integrations');
    expect(m.subject).toBe(
      'WhatsApp no está enviando mensajes — Cobranzas del Sur',
    );
    expect(m.text).toContain('Motivo: La cuenta de YCloud no tiene saldo.');
    expect(m.text).toContain('Qué hacer: Recarga saldo en YCloud.');
    expect(m.text).toContain('https://panel.x/integrations');
  });

  it('apertura de un incidente de plataforma: "Plataforma" en el asunto', () => {
    const m = openedEmail(
      { ...INC, scope: 'platform', companyId: null, service: 'voice', provider: 'elevenlabs' },
      null,
      'https://panel.x/platform',
    );
    expect(m.subject).toBe('Las llamadas no se están iniciando — Plataforma');
  });

  it('cierre: cuánto duró y cuántos envíos fallaron', () => {
    const m = resolvedEmail(INC, 'Cobranzas del Sur', new Date('2026-10-06T21:40:00Z'));
    expect(m.subject).toBe(
      'WhatsApp volvió a enviar mensajes — Cobranzas del Sur',
    );
    expect(m.text).toContain('Estuvo con problemas 2 h 10 min');
    expect(m.text).toContain('fallaron 14 envíos');
  });

  it.each([
    [5 * 60_000, '5 min'],
    [60 * 60_000, '1 h'],
    [130 * 60_000, '2 h 10 min'],
    [3 * 24 * 60 * 60_000, '3 días'],
    [20_000, '1 min'],
  ])('formatDuration(%i) → %s', (ms, texto) => {
    expect(formatDuration(ms)).toBe(texto);
  });
});
```

```ts
// src/alerts/incident-notifier.service.spec.ts
import { ConfigService } from '@nestjs/config';
import type { ProviderIncident } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformEmailService } from '../email/platform-email.service';
import { IncidentNotifier } from './incident-notifier.service';

const NOW = new Date('2026-10-06T19:30:00Z');

const INC = {
  id: 'i1',
  companyId: 'c1',
  scope: 'company',
  service: 'whatsapp',
  provider: 'ycloud',
  kind: 'account',
  reason: 'La cuenta de YCloud no tiene saldo.',
  hint: 'Recarga saldo en YCloud.',
  failureCount: 1,
  affectedCompanyIds: ['c1'],
  openedAt: NOW,
  lastFailureAt: NOW,
  resolvedAt: null,
  openNotifiedAt: null,
  key: 'company:c1:whatsapp:ycloud',
  openKey: 'company:c1:whatsapp:ycloud',
} as ProviderIncident;

function build(opts: {
  owners?: string[];
  admins?: string[];
  recent?: boolean;
  env?: Record<string, string>;
} = {}) {
  const prisma = {
    raw: {
      providerIncident: {
        findFirst: jest.fn().mockResolvedValue(opts.recent ? { id: 'viejo' } : null),
        update: jest.fn().mockResolvedValue({}),
      },
      membership: {
        findMany: jest.fn().mockResolvedValue(
          (opts.owners ?? ['duena@sur.cl']).map((email) => ({ user: { email } })),
        ),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(
          (opts.admins ?? ['admin@plataforma.cl']).map((email) => ({ email })),
        ),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Cobranzas del Sur' }),
      },
    },
  };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const env = opts.env ?? { PANEL_URL: 'https://panel.x' };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService<EnvVars, true>;
  const notifier = new IncidentNotifier(
    prisma as unknown as PrismaService,
    email as unknown as PlatformEmailService,
    config,
  );
  return { notifier, prisma, email };
}

describe('IncidentNotifier', () => {
  it('apertura de una cuenta de empresa: correo a los dueños con enlace a Integraciones', async () => {
    const h = build({ owners: ['duena@sur.cl', 'socio@sur.cl'] });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(true);

    expect(h.prisma.raw.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'c1', role: 'OWNER' }),
      }),
    );
    expect(h.email.send).toHaveBeenCalledTimes(2);
    expect(h.email.send.mock.calls[0][0]).toMatchObject({ to: 'duena@sur.cl' });
    expect(h.email.send.mock.calls[0][0].text).toContain('https://panel.x/integrations');
    expect(h.prisma.raw.providerIncident.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { openNotifiedAt: NOW },
    });
  });

  it('apertura de una cuenta de plataforma: correo a los administradores', async () => {
    const h = build();
    await h.notifier.opened({ ...INC, scope: 'platform', companyId: null }, NOW);
    expect(h.prisma.raw.user.findMany).toHaveBeenCalled();
    expect(h.email.send.mock.calls[0][0]).toMatchObject({ to: 'admin@plataforma.cl' });
    expect(h.email.send.mock.calls[0][0].text).toContain('https://panel.x/platform');
  });

  it('no repite el correo si ya se avisó otro incidente igual hace menos de 6 h', async () => {
    const h = build({ recent: true });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.prisma.raw.providerIncident.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: INC.key,
          id: { not: 'i1' },
          openNotifiedAt: { gte: new Date(NOW.getTime() - 6 * 3_600_000) },
        }),
      }),
    );
    expect(h.email.send).not.toHaveBeenCalled();
  });

  it('empresa sin dueños: no hay correo ni se marca como avisado', async () => {
    const h = build({ owners: [] });
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.email.send).not.toHaveBeenCalled();
    expect(h.prisma.raw.providerIncident.update).not.toHaveBeenCalled();
  });

  it('si todos los envíos del aviso fallan, no se marca como avisado', async () => {
    const h = build();
    h.email.send.mockRejectedValue(new Error('smtp caído'));
    await expect(h.notifier.opened(INC, NOW)).resolves.toBe(false);
    expect(h.prisma.raw.providerIncident.update).not.toHaveBeenCalled();
  });

  it('cierre: solo si se avisó la apertura', async () => {
    const h = build();
    await h.notifier.resolved(INC, NOW);
    expect(h.email.send).not.toHaveBeenCalled();

    await h.notifier.resolved({ ...INC, openNotifiedAt: NOW }, new Date(NOW.getTime() + 3_600_000));
    expect(h.email.send).toHaveBeenCalledTimes(1);
    expect(h.email.send.mock.calls[0][0].subject).toContain('volvió a enviar');
  });

  it('sin PANEL_URL usa CORS_ORIGIN, igual que el correo de contraseña', async () => {
    const h = build({ env: { CORS_ORIGIN: 'https://front.x,https://otro.x' } });
    await h.notifier.opened(INC, NOW);
    expect(h.email.send.mock.calls[0][0].text).toContain('https://front.x/integrations');
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npx jest src/alerts/incident-email.spec.ts src/alerts/incident-notifier.service.spec.ts`
Esperado: FALLA con "Cannot find module".

- [ ] **Paso 3: Implementar**

```ts
// src/common/config/panel-url.ts
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from './env.validation';

/**
 * URL pública del panel, sin barra final, para los enlaces de los correos
 * (recuperar contraseña, alertas). `PANEL_URL`; si falta, el primer origen de
 * `CORS_ORIGIN`; si tampoco, el Vite local.
 */
export function resolvePanelUrl(config: ConfigService<EnvVars, true>): string {
  return (
    config.get('PANEL_URL', { infer: true }) ??
    config.get('CORS_ORIGIN', { infer: true })?.split(',')[0]?.trim() ??
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}
```

En `src/auth/auth.service.ts`, el constructor recibe `config: ConfigService<EnvVars, true>` como último parámetro. Reemplazar el comentario y la asignación de las líneas 64-70 por:

```ts
    // Para los enlaces de los correos (mismo criterio que las alertas).
    this.panelUrl = resolvePanelUrl(config);
```

con el import `import { resolvePanelUrl } from '../common/config/panel-url';`.

```ts
// src/alerts/alerts.types.ts
/** Canal cuyo proveedor se vigila. */
export type AlertService = 'whatsapp' | 'email' | 'voice' | 'llm';
/** De quién es la cuenta: de una empresa o de la plataforma. */
export type AlertScope = 'company' | 'platform';

/** La cuenta por la que salió un envío. */
export interface HealthTarget {
  service: AlertService;
  /** 'ycloud' | 'meta' | 'resend' | 'smtp' | 'retell' | 'vapi' | 'elevenlabs' | 'anthropic' */
  provider: string;
  scope: AlertScope;
  /**
   * Empresa del envío: dueña de la cuenta si `scope` es 'company'; empresa
   * afectada si es 'platform' (puede faltar: procesos sin empresa).
   */
  companyId?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  ycloud: 'YCloud',
  meta: 'Meta',
  resend: 'Resend',
  smtp: 'SMTP',
  retell: 'Retell',
  vapi: 'Vapi',
  elevenlabs: 'ElevenLabs',
  anthropic: 'Anthropic',
};

/** Nombre del proveedor para mostrarlo a una persona. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Una clave por cuenta: empresa (o plataforma) + canal + proveedor. */
export function incidentKey(t: HealthTarget): string {
  return t.scope === 'company'
    ? `company:${t.companyId ?? 'sin-empresa'}:${t.service}:${t.provider}`
    : `platform:${t.service}:${t.provider}`;
}
```

```ts
// src/alerts/incident-email.ts
import type { ProviderIncident } from '@prisma/client';
import { AlertService, providerLabel } from './alerts.types';

const PROBLEM: Record<AlertService, string> = {
  whatsapp: 'WhatsApp no está enviando mensajes',
  email: 'El correo no está enviando mensajes',
  voice: 'Las llamadas no se están iniciando',
  llm: 'La IA no está respondiendo',
};

const BACK: Record<AlertService, string> = {
  whatsapp: 'WhatsApp volvió a enviar mensajes',
  email: 'El correo volvió a enviar mensajes',
  voice: 'Las llamadas volvieron a funcionar',
  llm: 'La IA volvió a responder',
};

export interface IncidentEmail {
  subject: string;
  text: string;
}

function service(i: ProviderIncident): AlertService {
  return i.service as AlertService;
}

function owner(companyName: string | null): string {
  return companyName ?? 'Plataforma';
}

/** Fecha legible en hora de Chile (donde opera la plataforma). */
function when(d: Date): string {
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** "5 min", "2 h 10 min", "3 días". Mínimo 1 min. */
export function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} días`;
  const rest = min % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function openedEmail(
  i: ProviderIncident,
  companyName: string | null,
  link: string,
): IncidentEmail {
  const problem = PROBLEM[service(i)];
  const lines = [
    `${problem} (${providerLabel(i.provider)}).`,
    '',
    `Motivo: ${i.reason}`,
    ...(i.hint ? [`Qué hacer: ${i.hint}`] : []),
    `Desde: ${when(i.openedAt)}`,
    '',
    'Mientras dure, los envíos por este canal fallan. El aviso se cierra solo ' +
      'cuando el proveedor vuelva a funcionar.',
    '',
    `Ver en el panel: ${link}`,
  ];
  return { subject: `${problem} — ${owner(companyName)}`, text: lines.join('\n') };
}

export function resolvedEmail(
  i: ProviderIncident,
  companyName: string | null,
  now: Date,
): IncidentEmail {
  const back = BACK[service(i)];
  const text =
    `${back} (${providerLabel(i.provider)}). Estuvo con problemas ` +
    `${formatDuration(now.getTime() - i.openedAt.getTime())} y fallaron ` +
    `${i.failureCount} envíos.`;
  return { subject: `${back} — ${owner(companyName)}`, text };
}
```

```ts
// src/alerts/incident-notifier.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PanelRole, ProviderIncident } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { resolvePanelUrl } from '../common/config/panel-url';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformEmailService } from '../email/platform-email.service';
import { IncidentEmail, openedEmail, resolvedEmail } from './incident-email';

/** Como máximo un correo de apertura cada 6 h por cuenta y proveedor. */
const OPEN_EMAIL_THROTTLE_MS = 6 * 60 * 60 * 1000;

/**
 * Correos de los incidentes de proveedores. Salen por el correo de la
 * PLATAFORMA (`PlatformEmailService`): no dependen de la cuenta de correo de
 * la empresa, que puede ser justo la que está fallando. A los dueños de la
 * empresa si la cuenta es suya; a los administradores si es de la plataforma.
 */
@Injectable()
export class IncidentNotifier {
  private readonly logger = new Logger(IncidentNotifier.name);
  private readonly panelUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: PlatformEmailService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.panelUrl = resolvePanelUrl(config);
  }

  /**
   * Avisa que se abrió un incidente. Si el mismo proveedor ya avisó hace
   * menos de 6 h (se recuperó y volvió a caer), no repite el correo: el aviso
   * del panel basta. Devuelve si mandó al menos un correo.
   */
  async opened(incident: ProviderIncident, now = new Date()): Promise<boolean> {
    const recent = await this.prisma.raw.providerIncident.findFirst({
      where: {
        key: incident.key,
        id: { not: incident.id },
        openNotifiedAt: { gte: new Date(now.getTime() - OPEN_EMAIL_THROTTLE_MS) },
      },
      select: { id: true },
    });
    if (recent) return false;

    const link = `${this.panelUrl}/${incident.scope === 'company' ? 'integrations' : 'platform'}`;
    const sent = await this.sendAll(
      incident,
      openedEmail(incident, await this.companyName(incident), link),
    );
    if (sent) {
      await this.prisma.raw.providerIncident.update({
        where: { id: incident.id },
        data: { openNotifiedAt: now },
      });
    }
    return sent;
  }

  /** Avisa que se cerró, solo si antes se avisó la apertura. */
  async resolved(incident: ProviderIncident, now = new Date()): Promise<void> {
    if (!incident.openNotifiedAt) return;
    await this.sendAll(
      incident,
      resolvedEmail(incident, await this.companyName(incident), now),
    );
  }

  /** Manda a cada destinatario; devuelve si al menos uno salió. */
  private async sendAll(
    incident: ProviderIncident,
    message: IncidentEmail,
  ): Promise<boolean> {
    const to = await this.recipients(incident);
    if (to.length === 0) {
      this.logger.warn(`Incidente ${incident.key} sin destinatarios para avisar.`);
      return false;
    }
    let sent = 0;
    for (const address of to) {
      try {
        await this.email.send({ to: address, ...message });
        sent++;
      } catch (e) {
        this.logger.warn(
          `No se pudo avisar el incidente ${incident.key} a ${address}: ${(e as Error).message}`,
        );
      }
    }
    return sent > 0;
  }

  private async recipients(incident: ProviderIncident): Promise<string[]> {
    if (incident.scope === 'company' && incident.companyId) {
      const owners = await this.prisma.raw.membership.findMany({
        where: {
          companyId: incident.companyId,
          role: PanelRole.OWNER,
          user: { isActive: true },
        },
        select: { user: { select: { email: true } } },
      });
      return owners.map((m) => m.user.email);
    }
    const admins = await this.prisma.raw.user.findMany({
      where: { isPlatformAdmin: true, isActive: true },
      select: { email: true },
    });
    return admins.map((u) => u.email);
  }

  private async companyName(incident: ProviderIncident): Promise<string | null> {
    if (incident.scope !== 'company' || !incident.companyId) return null;
    const company = await this.prisma.raw.company.findUnique({
      where: { id: incident.companyId },
      select: { name: true },
    });
    return company?.name ?? null;
  }
}
```

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Correr: `npx jest src/alerts src/auth`
Esperado: PASA, incluidas las specs de `auth` que ya existían.

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/alerts src/common/config/panel-url.ts src/auth/auth.service.ts && npm run build`
Esperado: sin errores.

---

### Tarea 5: `ProviderHealthService` y módulo `AlertsModule`

**Archivos:**
- Crear: `src/alerts/provider-health.service.ts`, `src/alerts/alerts.module.ts`
- Modificar: `src/app.module.ts`, para importar `AlertsModule` junto a `EmailModule` y `VoiceModule`.
- Test: `src/alerts/provider-health.service.spec.ts`

**Interfaces:**
- Consume: `classifyProviderError` (Tarea 1); `HealthTarget`, `incidentKey`, `providerLabel` e `IncidentNotifier` (Tarea 4); `REDIS_CLIENT` (`src/common/rate-limit/rate-limit.guard.ts`).
- Produce:
  - `ProviderHealthService.observe<T>(target: HealthTarget, send: () => Promise<T>): Promise<T>`.
  - `success(target, now?)` y `failure(target, error, now?)`: públicos, para tests.
  - Constantes `TRANSIENT_THRESHOLD = 3` y `TRANSIENT_WINDOW_SECONDS = 900`.
  - `AlertsModule` global, que exporta `ProviderHealthService`.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// src/alerts/provider-health.service.spec.ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { IncidentNotifier } from './incident-notifier.service';
import { ProviderError } from './provider-error';
import { ProviderHealthService } from './provider-health.service';
import type { HealthTarget } from './alerts.types';

const NOW = new Date('2026-10-06T19:30:00Z');
const WA: HealthTarget = { service: 'whatsapp', provider: 'ycloud', scope: 'company', companyId: 'c1' };
const SIN_SALDO = new ProviderError('Fallo (YCloud 403)', 403, 'BALANCE_INSUFFICIENT');
const CAIDO = new ProviderError('Fallo (YCloud 503)', 503);
const TELEFONO_MALO = new ProviderError('Fallo (YCloud 400: Invalid phone)', 400);

function build(opts: { open?: object | null; streak?: number[]; redisDown?: boolean } = {}) {
  const incident = {
    findUnique: jest.fn().mockResolvedValue(opts.open ?? null),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'nuevo', ...data })),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { raw: { providerIncident: incident } } as unknown as PrismaService;
  const incr = jest.fn();
  (opts.streak ?? [1]).forEach((n) => incr.mockResolvedValueOnce(n));
  if (opts.redisDown) incr.mockRejectedValue(new Error('redis caído'));
  const store = {
    incr,
    expire: jest.fn().mockResolvedValue(1),
    del: opts.redisDown
      ? jest.fn().mockRejectedValue(new Error('redis caído'))
      : jest.fn().mockResolvedValue(1),
  };
  const notifier = {
    opened: jest.fn().mockResolvedValue(true),
    resolved: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProviderHealthService(
    prisma,
    store,
    notifier as unknown as IncidentNotifier,
  );
  return { service, incident, store, notifier };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('ProviderHealthService — fallos', () => {
  it('error de cuenta: abre el incidente al primer fallo y avisa', async () => {
    const h = build();
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        scope: 'company',
        service: 'whatsapp',
        provider: 'ycloud',
        kind: 'account',
        reason: 'La cuenta de YCloud no tiene saldo.',
        hint: 'Recarga saldo en YCloud.',
        failureCount: 1,
        affectedCompanyIds: ['c1'],
        key: 'company:c1:whatsapp:ycloud',
        openKey: 'company:c1:whatsapp:ycloud',
        openedAt: NOW,
      }),
    });
    expect(h.notifier.opened).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nuevo' }),
      NOW,
    );
  });

  it('error del mensaje: no abre nada, ni cuenta para la racha', async () => {
    const h = build();
    await h.service.failure(WA, TELEFONO_MALO, NOW);
    expect(h.incident.findUnique).not.toHaveBeenCalled();
    expect(h.store.incr).not.toHaveBeenCalled();
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('muchos errores del mensaje seguidos (importación con teléfonos malos) no abren nada', async () => {
    const h = build();
    for (let i = 0; i < 25; i++) await h.service.failure(WA, TELEFONO_MALO, NOW);
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('pasajero: abre recién al tercer fallo seguido, con esos 3 fallos', async () => {
    const h = build({ streak: [1, 2, 3] });
    await h.service.failure(WA, CAIDO, NOW);
    await h.service.failure(WA, CAIDO, NOW);
    expect(h.incident.create).not.toHaveBeenCalled();
    await h.service.failure(WA, CAIDO, NOW);
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'transient', failureCount: 3 }),
    });
    // La ventana corre desde el primer fallo de la racha.
    expect(h.store.expire).toHaveBeenCalledTimes(1);
    expect(h.store.expire).toHaveBeenCalledWith(
      'provider-health:streak:company:c1:whatsapp:ycloud',
      900,
    );
  });

  it('pasajero sin Redis: no abre y no rompe', async () => {
    const h = build({ redisDown: true });
    await expect(h.service.failure(WA, CAIDO, NOW)).resolves.toBeUndefined();
    expect(h.incident.create).not.toHaveBeenCalled();
  });

  it('error de cuenta sin Redis: abre igual (no depende de Redis)', async () => {
    const h = build({ redisDown: true });
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.create).toHaveBeenCalled();
  });

  it('con un incidente ya abierto: suma el fallo, agrega la empresa y no avisa de nuevo', async () => {
    const h = build({ open: { id: 'abierto', affectedCompanyIds: ['c9'] } });
    await h.service.failure(
      { service: 'voice', provider: 'elevenlabs', scope: 'platform', companyId: 'c1' },
      SIN_SALDO,
      NOW,
    );
    expect(h.incident.create).not.toHaveBeenCalled();
    expect(h.incident.update).toHaveBeenCalledWith({
      where: { id: 'abierto' },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: NOW,
        affectedCompanyIds: ['c9', 'c1'],
      },
    });
    expect(h.notifier.opened).not.toHaveBeenCalled();
  });

  it('carrera: si otro proceso lo abrió primero (P2002), suma el fallo y no avisa', async () => {
    const h = build();
    h.incident.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    h.incident.findUnique
      .mockResolvedValueOnce(null) // antes de crear: no había
      .mockResolvedValueOnce({ id: 'del-otro', affectedCompanyIds: ['c1'] });
    await h.service.failure(WA, SIN_SALDO, NOW);
    expect(h.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'del-otro' } }),
    );
    expect(h.notifier.opened).not.toHaveBeenCalled();
  });

  it('plataforma sin empresa en contexto (proceso nocturno): abre sin empresas afectadas', async () => {
    const h = build();
    await h.service.failure(
      { service: 'llm', provider: 'anthropic', scope: 'platform' },
      Object.assign(new Error('Your credit balance is too low'), { status: 400 }),
      NOW,
    );
    expect(h.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: null,
        affectedCompanyIds: [],
        key: 'platform:llm:anthropic',
      }),
    });
  });
});

describe('ProviderHealthService — éxitos', () => {
  it('cierra el incidente abierto, borra la racha y avisa el cierre', async () => {
    const abierto = { id: 'abierto', openNotifiedAt: NOW, openedAt: NOW, failureCount: 3 };
    const h = build({ open: abierto });
    await h.service.success(WA, NOW);
    expect(h.store.del).toHaveBeenCalledWith('provider-health:streak:company:c1:whatsapp:ycloud');
    expect(h.incident.updateMany).toHaveBeenCalledWith({
      where: { id: 'abierto', resolvedAt: null },
      data: { resolvedAt: NOW, openKey: null },
    });
    expect(h.notifier.resolved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abierto', resolvedAt: NOW }),
      NOW,
    );
  });

  it('sin incidente abierto: no escribe nada', async () => {
    const h = build();
    await h.service.success(WA, NOW);
    expect(h.incident.updateMany).not.toHaveBeenCalled();
    expect(h.notifier.resolved).not.toHaveBeenCalled();
  });

  it('si otro proceso ya lo cerró, no repite el aviso', async () => {
    const h = build({ open: { id: 'abierto', openNotifiedAt: NOW } });
    h.incident.updateMany.mockResolvedValueOnce({ count: 0 });
    await h.service.success(WA, NOW);
    expect(h.notifier.resolved).not.toHaveBeenCalled();
  });

  it('sin Redis: igual cierra el incidente', async () => {
    const h = build({ open: { id: 'abierto' }, redisDown: true });
    await h.service.success(WA, NOW);
    expect(h.incident.updateMany).toHaveBeenCalled();
  });
});

describe('ProviderHealthService.observe', () => {
  it('devuelve el resultado del envío y anota el éxito', async () => {
    const h = build();
    const spy = jest.spyOn(h.service, 'success');
    await expect(h.service.observe(WA, async () => 'ok')).resolves.toBe('ok');
    await flush();
    expect(spy).toHaveBeenCalledWith(WA);
  });

  it('relanza el mismo error del envío y anota el fallo', async () => {
    const h = build();
    const spy = jest.spyOn(h.service, 'failure');
    await expect(
      h.service.observe(WA, () => Promise.reject(SIN_SALDO)),
    ).rejects.toBe(SIN_SALDO);
    await flush();
    expect(spy).toHaveBeenCalledWith(WA, SIN_SALDO);
  });

  it('si anotar falla, el envío no se entera', async () => {
    const h = build();
    jest.spyOn(h.service, 'success').mockRejectedValue(new Error('db caída'));
    await expect(h.service.observe(WA, async () => 'ok')).resolves.toBe('ok');
    await flush();
  });
});
```

- [ ] **Paso 2: Correr el test y verificar que falla**

Correr: `npx jest src/alerts/provider-health.service.spec.ts`
Esperado: FALLA con "Cannot find module './provider-health.service'".

- [ ] **Paso 3: Implementar**

```ts
// src/alerts/provider-health.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ProviderIncident } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../common/rate-limit/rate-limit.guard';
import { HealthTarget, incidentKey, providerLabel } from './alerts.types';
import { IncidentNotifier } from './incident-notifier.service';
import { classifyProviderError } from './provider-error';

/** Fallos pasajeros seguidos que abren un incidente… */
export const TRANSIENT_THRESHOLD = 3;
/** …dentro de esta ventana, contada desde el primero. */
export const TRANSIENT_WINDOW_SECONDS = 15 * 60;

/** Lo mínimo de ioredis que usa la racha (así se prueba sin Redis). */
export interface StreakStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
}

function streakKey(key: string): string {
  return `provider-health:streak:${key}`;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * Salud de los proveedores externos, medida con los envíos reales. Cada punto
 * de salida (WhatsApp, correo, voz, IA) pasa su envío por `observe`: si una
 * cuenta empieza a fallar, se abre un incidente (uno por cuenta) y se avisa;
 * con el primer envío exitoso se cierra solo. Ver
 * docs/superpowers/specs/2026-10-08-alertas-proveedores-design.md.
 */
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly store: StreakStore,
    private readonly notifier: IncidentNotifier,
  ) {}

  /**
   * Ejecuta un envío y anota si funcionó, sin cambiar su resultado: devuelve
   * lo mismo o relanza el mismo error. El registro corre en segundo plano y
   * nunca demora ni rompe el envío.
   */
  async observe<T>(target: HealthTarget, send: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await send();
    } catch (error) {
      this.background(() => this.failure(target, error));
      throw error;
    }
    this.background(() => this.success(target));
    return result;
  }

  /** Un envío funcionó: corta la racha y cierra el incidente abierto, si hay. */
  async success(target: HealthTarget, now = new Date()): Promise<void> {
    const key = incidentKey(target);
    await this.store.del(streakKey(key)).catch(() => 0);
    const open = await this.prisma.raw.providerIncident.findUnique({
      where: { openKey: key },
    });
    if (!open) return;
    const { count } = await this.prisma.raw.providerIncident.updateMany({
      where: { id: open.id, resolvedAt: null },
      data: { resolvedAt: now, openKey: null },
    });
    if (count !== 1) return; // otro proceso lo cerró primero
    this.logger.log(`Incidente cerrado: ${key}`);
    await this.notifier.resolved({ ...open, resolvedAt: now }, now);
  }

  /** Un envío falló: suma al incidente abierto o decide si abrir uno. */
  async failure(
    target: HealthTarget,
    error: unknown,
    now = new Date(),
  ): Promise<void> {
    const verdict = classifyProviderError(error, providerLabel(target.provider));
    if (verdict.kind === 'request') return;

    const key = incidentKey(target);
    if (await this.bump(key, target, now)) return;

    let failures = 1;
    if (verdict.kind === 'transient') {
      failures = await this.streak(key);
      if (failures < TRANSIENT_THRESHOLD) return;
    }

    let created: ProviderIncident;
    try {
      created = await this.prisma.raw.providerIncident.create({
        data: {
          companyId:
            target.scope === 'company' ? (target.companyId ?? null) : null,
          scope: target.scope,
          service: target.service,
          provider: target.provider,
          kind: verdict.kind,
          reason: verdict.reason,
          hint: verdict.hint ?? null,
          failureCount: failures,
          affectedCompanyIds: target.companyId ? [target.companyId] : [],
          openedAt: now,
          lastFailureAt: now,
          key,
          openKey: key,
        },
      });
    } catch (e) {
      // Otro proceso lo abrió en el mismo instante: ese avisa, acá solo se suma.
      if (isUniqueViolation(e)) {
        await this.bump(key, target, now);
        return;
      }
      throw e;
    }
    this.logger.warn(`Incidente abierto: ${key} — ${verdict.reason}`);
    await this.notifier.opened(created, now);
  }

  /** Suma un fallo al incidente abierto de esa clave. Devuelve si lo había. */
  private async bump(
    key: string,
    target: HealthTarget,
    now: Date,
  ): Promise<boolean> {
    const open = await this.prisma.raw.providerIncident.findUnique({
      where: { openKey: key },
      select: { id: true, affectedCompanyIds: true },
    });
    if (!open) return false;
    const nuevaEmpresa =
      target.companyId && !open.affectedCompanyIds.includes(target.companyId);
    await this.prisma.raw.providerIncident.update({
      where: { id: open.id },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: now,
        ...(nuevaEmpresa && {
          affectedCompanyIds: [...open.affectedCompanyIds, target.companyId as string],
        }),
      },
    });
    return true;
  }

  /** Fallos pasajeros seguidos en la ventana. Sin Redis: 0 (no abre). */
  private async streak(key: string): Promise<number> {
    try {
      const n = await this.store.incr(streakKey(key));
      if (n === 1) {
        await this.store.expire(streakKey(key), TRANSIENT_WINDOW_SECONDS);
      }
      return n;
    } catch (e) {
      this.logger.warn(
        `Racha de fallos sin Redis (${(e as Error).message}): no se cuenta.`,
      );
      return 0;
    }
  }

  private background(task: () => Promise<void>): void {
    void task().catch((e: Error) =>
      this.logger.warn(`No se pudo registrar la salud del proveedor: ${e.message}`),
    );
  }
}
```

```ts
// src/alerts/alerts.module.ts
import { Global, Module } from '@nestjs/common';
import { ProviderHealthService } from './provider-health.service';
import { IncidentNotifier } from './incident-notifier.service';

/**
 * Alertas de proveedores. Global porque lo usan los puntos de salida de
 * varios módulos (WhatsApp, correo, voz, IA). Depende de Prisma, Redis
 * (`REDIS_CLIENT`) y `PlatformEmailService`, que también son globales.
 */
@Global()
@Module({
  providers: [ProviderHealthService, IncidentNotifier],
  exports: [ProviderHealthService],
})
export class AlertsModule {}
```

En `src/app.module.ts`: agregar `import { AlertsModule } from './alerts/alerts.module';` y `AlertsModule,` en `imports`, justo después de `EmailModule,`.

- [ ] **Paso 4: Correr el test y verificar que pasa**

Correr: `npx jest src/alerts`
Esperado: PASA.

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/alerts src/app.module.ts && npm run build`
Esperado: sin errores.

---

### Tarea 6: Enganchar los 4 puntos de envío

**Archivos:**
- Modificar:
  - `src/whatsapp/whatsapp.service.ts`
  - `src/email/email.service.ts`
  - `src/voice/voice.service.ts`
  - `src/llm/anthropic.service.ts`
- Test:
  - Crear: `src/whatsapp/whatsapp.service.spec.ts`, `src/llm/anthropic.service.spec.ts`
  - Modificar: `src/email/email.service.spec.ts`, `src/voice/voice.service.spec.ts`

**Interfaces:**
- Consume: `ProviderHealthService.observe` y `HealthTarget` (Tareas 4-5).
- Produce: los 4 servicios reciben `health: ProviderHealthService` como **último** parámetro **obligatorio** del constructor. No es `@Optional`: si el cableado falla, la app no arranca, en vez de quedar sin alertas en silencio.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// src/whatsapp/whatsapp.service.spec.ts
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { WhatsappService } from './whatsapp.service';

function build(cred: unknown) {
  const credentials = {
    get: jest.fn().mockResolvedValue(cred),
  } as unknown as CredentialsService;
  const health = {
    observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()),
  };
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  return {
    service: new WhatsappService(
      credentials,
      health as unknown as ProviderHealthService,
    ),
    health,
  };
}

const run = <T>(fn: () => Promise<T>) =>
  TenantContext.run({ companyId: 'c1', correlationId: 'x' }, fn);

describe('WhatsappService y la salud del proveedor', () => {
  it('con YCloud: el envío pasa por observe como cuenta de la empresa', async () => {
    const h = build({
      provider: 'ycloud',
      isActive: true,
      secret: 'k',
      config: { from: '+56900000000' },
    });
    await run(() => h.service.send('+56911111111', 'hola'));
    expect(h.health.observe).toHaveBeenCalledWith(
      { service: 'whatsapp', provider: 'ycloud', scope: 'company', companyId: 'c1' },
      expect.any(Function),
    );
  });

  it('plantilla con Meta: también', async () => {
    const h = build({
      provider: 'meta',
      isActive: true,
      secret: 'k',
      config: { phoneNumberId: '123' },
    });
    await run(() =>
      h.service.sendTemplate('+56911111111', {
        name: 'apertura',
        languageCode: 'es',
        bodyParams: [],
      }),
    );
    expect(h.health.observe).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta' }),
      expect.any(Function),
    );
  });

  it('sin WhatsApp configurado (log): no se registra nada', async () => {
    const h = build(null);
    await run(() => h.service.send('+56911111111', 'hola'));
    expect(h.health.observe).not.toHaveBeenCalled();
  });
});
```

```ts
// src/llm/anthropic.service.spec.ts
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../common/config/env.validation';
import { TenantContext } from '../common/tenant/tenant-context';
import { ProviderHealthService } from '../alerts/provider-health.service';
import { AnthropicService } from './anthropic.service';

function build() {
  const env: Record<string, unknown> = {
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_MODEL: 'claude-test',
    ANTHROPIC_EFFORT: 'medium',
    ANTHROPIC_MAX_TOKENS: 1000,
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService<EnvVars, true>;
  const health = {
    observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()),
  };
  const service = new AnthropicService(config, health as unknown as ProviderHealthService);
  const create = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hola' }] });
  (service as unknown as { client: unknown }).client = { messages: { create } };
  return { service, health, create };
}

describe('AnthropicService y la salud del proveedor', () => {
  it('cada llamada al modelo pasa por observe como cuenta de la plataforma', async () => {
    const h = build();
    await TenantContext.run({ companyId: 'c1', correlationId: 'x' }, () =>
      h.service.createMessage({ system: 's', messages: [], tools: [] }),
    );
    expect(h.health.observe).toHaveBeenCalledWith(
      { service: 'llm', provider: 'anthropic', scope: 'platform', companyId: 'c1' },
      expect.any(Function),
    );
  });

  it('sin empresa en contexto (proceso nocturno): companyId vacío', async () => {
    const h = build();
    await expect(h.service.complete('s', 'u')).resolves.toBe('hola');
    expect(h.health.observe).toHaveBeenCalledWith(
      { service: 'llm', provider: 'anthropic', scope: 'platform', companyId: undefined },
      expect.any(Function),
    );
  });
});
```

En `src/email/email.service.spec.ts`:
- Dentro de `build()`: `const health = { observe: jest.fn((_t: unknown, send: () => Promise<unknown>) => send()) };`.
- El servicio se construye con `new EmailService(credentials, managed, quota, health as unknown as ProviderHealthService)`.
- Se devuelve `health` en el objeto, más el import de `ProviderHealthService`.
- Agregar:

```ts
  it('registra la salud: cuenta propia como empresa, gestionado como plataforma', async () => {
    mockFetch();
    const propia = build({
      byo: { provider: 'resend', isActive: true, secret: 're_propia', config: { from: 'a@b.cl' } },
    });
    await run(() => propia.service.send(MENSAJE));
    expect(propia.health.observe).toHaveBeenCalledWith(
      { service: 'email', provider: 'resend', scope: 'company', companyId: 'c1' },
      expect.any(Function),
    );

    const gestionado = build({
      apiKey: 're_plataforma',
      sender: { mode: 'shared', from: 'n@plataforma.cl', replyTo: undefined },
    });
    await run(() => gestionado.service.send(MENSAJE));
    expect(gestionado.health.observe).toHaveBeenCalledWith(
      { service: 'email', provider: 'resend', scope: 'platform', companyId: 'c1' },
      expect.any(Function),
    );
  });

  it('el tope diario no cuenta como fallo del proveedor', async () => {
    mockFetch();
    const h = build({
      apiKey: 're_plataforma',
      sender: { mode: 'shared', from: 'n@plataforma.cl', replyTo: undefined },
      allowed: false,
    });
    await expect(run(() => h.service.send(MENSAJE))).rejects.toThrow('Límite diario');
    expect(h.health.observe).not.toHaveBeenCalled();
  });
```

En `src/voice/voice.service.spec.ts`, igual que en el de correo:
- Dentro de `build()`: el `health` de paso que llama a `send()`.
- El servicio se construye con `new VoiceService(credentials, usage as unknown as VoiceUsageService, config, health as unknown as ProviderHealthService)`.
- Se devuelve `health`.
- Agregar en el `describe` de voz gestionada:

```ts
  it('la voz gestionada se registra como cuenta de la plataforma', async () => {
    mockFetch(
      res(200, { provider: 'twilio' }),
      res(200, { success: true, conversation_id: 'conv_1' }),
    );
    const h = build({});
    await run(() => h.service.startCall(PARAMS));
    expect(h.health.observe).toHaveBeenCalledWith(
      { service: 'voice', provider: 'elevenlabs', scope: 'platform', companyId: 'c1' },
      expect.any(Function),
    );
  });

  it('sin minutos no se llama ni cuenta como fallo del proveedor', async () => {
    const h = build({ check: { allowed: false, reason: 'Se acabaron los minutos.' } });
    await expect(run(() => h.service.startCall(PARAMS))).rejects.toThrow();
    expect(h.health.observe).not.toHaveBeenCalled();
  });
```

y otro para la cuenta propia, con la credencial de Vapi:

```ts
  it('la cuenta propia se registra como cuenta de la empresa', async () => {
    mockFetch(res(200, { id: 'call_1' }));
    const h = build({ byo: { provider: 'vapi', isActive: true, secret: 'k', config: {} } });
    await run(() => h.service.startCall(PARAMS));
    expect(h.health.observe).toHaveBeenCalledWith(
      { service: 'voice', provider: 'vapi', scope: 'company', companyId: 'c1' },
      expect.any(Function),
    );
  });
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npx jest src/whatsapp/whatsapp.service.spec.ts src/llm src/email/email.service.spec.ts src/voice/voice.service.spec.ts`
Esperado: FALLA. TypeScript se queja del argumento de más en los constructores, u `observe` nunca se llama.

- [ ] **Paso 3: Implementar**

`src/whatsapp/whatsapp.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { TenantContext } from '../common/tenant/tenant-context';
import { CredentialsService } from '../integrations/credentials.service';
import { ProviderHealthService } from '../alerts/provider-health.service';
// (imports de proveedores sin cambios)

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsappService');

  constructor(
    private readonly credentials: CredentialsService,
    private readonly health: ProviderHealthService,
  ) {}

  /** El proveedor de la empresa y su nombre (null = log, no se vigila). */
  private async provider(): Promise<{
    provider: WhatsappProvider;
    name: string | null;
  }> {
    const c = await this.credentials.get('whatsapp');
    if (c?.isActive && c.secret) {
      if (c.provider === 'ycloud' && c.config.from) {
        return {
          name: 'ycloud',
          provider: new YCloudWhatsappProvider(c.secret, String(c.config.from)),
        };
      }
      if (c.provider === 'meta' && c.config.phoneNumberId) {
        return {
          name: 'meta',
          provider: new MetaCloudWhatsappProvider(
            c.secret,
            String(c.config.phoneNumberId),
          ),
        };
      }
    }
    this.logger.warn(
      'WhatsApp no configurado para la empresa: no se envía (configúralo en el panel).',
    );
    return { name: null, provider: new LogWhatsappProvider() };
  }

  async send(to: string, text: string): Promise<void> {
    const { provider, name } = await this.provider();
    return this.observe(name, () => provider.send(to, text));
  }

  /** Envía una plantilla aprobada (para iniciar fuera de la ventana de 24h). */
  async sendTemplate(
    to: string,
    template: WhatsappTemplateMessage,
  ): Promise<void> {
    const { provider, name } = await this.provider();
    return this.observe(name, () => provider.sendTemplate(to, template));
  }

  /** WhatsApp siempre es cuenta de la empresa (sus llaves). */
  private observe<T>(name: string | null, send: () => Promise<T>): Promise<T> {
    if (!name) return send();
    return this.health.observe(
      {
        service: 'whatsapp',
        provider: name,
        scope: 'company',
        companyId: TenantContext.getCompanyId(),
      },
      send,
    );
  }
}
```

`src/email/email.service.ts`: agregar `private readonly health: ProviderHealthService` como último parámetro del constructor (con su import) y cambiar `send`:

```ts
  async send(message: EmailMessage): Promise<void> {
    const cred = await this.credentials.get('email');
    const byo = byoEmailProvider(cred);
    if (byo && cred) {
      return this.health.observe(
        {
          service: 'email',
          provider: cred.provider,
          scope: 'company',
          companyId: TenantContext.getCompanyId(),
        },
        () => byo.send(message),
      );
    }

    // (desde `const companyId = TenantContext.requireCompanyId();` hasta el
    //  chequeo del cupo: sin cambios)

    await this.health.observe(
      { service: 'email', provider: 'resend', scope: 'platform', companyId },
      () =>
        new ResendEmailProvider(apiKey, sender.from).send({
          ...message,
          replyTo: message.replyTo ?? sender.replyTo,
          // La empresa en cada envío: los eventos de Resend (rebotes, quejas)
          // vuelven con estas etiquetas y así se sabe de quién son.
          tags: { ...message.tags, company_id: companyId },
        }),
    );
  }
```

`src/voice/voice.service.ts`: agregar `private readonly health: ProviderHealthService` como último parámetro del constructor (después de `config`, con su import). En `startCall`:

```ts
    if (byo) {
      const result = await this.health.observe(
        { service: 'voice', provider: byo.name, scope: 'company', companyId },
        () => byo.provider.startCall(params),
      );
      // (el registro de VoiceCall queda igual)
```

TypeScript no conserva la verificación de nulo de `this.managed` dentro de una función flecha. Por eso hay que copiarlo a una variable local: justo antes del `if (!this.managed) {` de `startCall`, agregar `const managed = this.managed;`. Después, cambiar ese `if` por `if (!managed) {` y usar `managed` en vez de `this.managed` en el resto del método (el agente de cobranza y la llamada):

```ts
    const agentId =
      params.agentType === AgentType.COBRANZA && managed.agentCobranza
        ? managed.agentCobranza
        : managed.agentDefault;
    const result = await this.health.observe(
      { service: 'voice', provider: 'elevenlabs', scope: 'platform', companyId },
      () =>
        new ElevenLabsVoiceProvider({
          apiKey: managed.apiKey,
          agentId,
          phoneNumberId: managed.phoneNumberId,
        }).startCall(params),
    );
```

`src/llm/anthropic.service.ts`: agregar `private readonly health: ProviderHealthService` como segundo parámetro del constructor (con los imports de `ProviderHealthService` y `TenantContext`) y envolver las dos llamadas al SDK:

```ts
  /** La IA siempre es cuenta de la plataforma. */
  private observe<T>(send: () => Promise<T>): Promise<T> {
    return this.health.observe(
      {
        service: 'llm',
        provider: 'anthropic',
        scope: 'platform',
        companyId: TenantContext.getCompanyId(),
      },
      send,
    );
  }
```

En `complete`: `const response = await this.observe(() => client.messages.create({...}))`, con `const client = this.client;` tomado después del chequeo de "no configurado". En `createMessage`: `return this.observe(() => client.messages.create({...}))`. El `throw` de "no está configurado" queda **fuera** de `observe`.

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Correr: `npx jest`
Esperado: toda la suite PASA. Si alguna otra spec construye estos servicios con `new` (hoy solo las de correo y voz), pasarle el `health` de paso de la misma forma.

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/whatsapp src/email src/voice src/llm && npm run build`
Esperado: sin errores.

---

### Tarea 7: API: `GET /panel/alerts` y `GET /platform/incidents`

**Archivos:**
- Crear: `src/alerts/alerts-query.service.ts`, `src/alerts/panel-alerts.controller.ts`
- Modificar:
  - `src/alerts/alerts.module.ts`: controller más `AlertsQueryService` en providers y exports.
  - `src/platform/platform.controller.ts`: endpoint y constructor.
- Test: `src/alerts/alerts-query.service.spec.ts`, `src/alerts/alerts-routes.spec.ts`

**Interfaces:**
- Consume: el modelo `ProviderIncident` y `providerLabel`.
- Produce, con fechas serializadas como ISO en JSON:
  - `AlertsQueryService.forCompany(companyId: string, userId: string): Promise<PanelAlerts>`.
  - `AlertsQueryService.listForPlatform(now?: Date): Promise<PlatformIncidentRow[]>`.

```ts
interface OwnAlert { id: string; service: string; provider: string; providerLabel: string; reason: string; hint: string | null; openedAt: Date; failureCount: number }
interface PlatformAlert { id: string; service: string; openedAt: Date; providerLabel?: string; reason?: string; hint?: string | null; failureCount?: number }
interface PanelAlerts { own: OwnAlert[]; platform: PlatformAlert[] }
interface PlatformIncidentRow { id: string; scope: string; service: string; provider: string; providerLabel: string; companyName: string | null; kind: string; reason: string; hint: string | null; openedAt: Date; resolvedAt: Date | null; failureCount: number; affectedCompanies: number }
```

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
// src/alerts/alerts-query.service.spec.ts
import { PrismaService } from '../common/prisma/prisma.service';
import { AlertsQueryService } from './alerts-query.service';

const NOW = new Date('2026-10-08T12:00:00Z');
const BASE = {
  hint: null,
  kind: 'account',
  failureCount: 2,
  openedAt: NOW,
  resolvedAt: null,
  affectedCompanyIds: ['c1'],
};
const PROPIO = { ...BASE, id: 'p1', scope: 'company', companyId: 'c1', service: 'whatsapp', provider: 'ycloud', reason: 'Sin saldo.' };
const DE_PLATAFORMA = { ...BASE, id: 'x1', scope: 'platform', companyId: null, service: 'voice', provider: 'elevenlabs', reason: 'Twilio suspendido.' };

function build(admin: boolean) {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce([PROPIO])
    .mockResolvedValueOnce([DE_PLATAFORMA]);
  const prisma = {
    raw: {
      providerIncident: { findMany },
      user: { findUnique: jest.fn().mockResolvedValue({ isPlatformAdmin: admin }) },
    },
  } as unknown as PrismaService;
  return { service: new AlertsQueryService(prisma), findMany };
}

describe('AlertsQueryService.forCompany', () => {
  it('usuario normal: los propios con detalle; los de plataforma que lo afectan, sin detalle', async () => {
    const h = build(false);
    const r = await h.service.forCompany('c1', 'u1');

    expect(h.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'c1',
      scope: 'company',
      resolvedAt: null,
    });
    expect(h.findMany.mock.calls[1][0].where).toEqual({
      scope: 'platform',
      resolvedAt: null,
      affectedCompanyIds: { has: 'c1' },
    });
    expect(r.own).toEqual([
      expect.objectContaining({ id: 'p1', providerLabel: 'YCloud', reason: 'Sin saldo.' }),
    ]);
    expect(r.platform).toEqual([{ id: 'x1', service: 'voice', openedAt: NOW }]);
  });

  it('administrador de la plataforma: todos los de plataforma, con detalle', async () => {
    const h = build(true);
    const r = await h.service.forCompany('c1', 'admin');
    expect(h.findMany.mock.calls[1][0].where).toEqual({
      scope: 'platform',
      resolvedAt: null,
    });
    expect(r.platform[0]).toMatchObject({
      providerLabel: 'ElevenLabs',
      reason: 'Twilio suspendido.',
    });
  });
});

describe('AlertsQueryService.listForPlatform', () => {
  it('abiertos y cerrados en los últimos 7 días, con empresa y empresas afectadas', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...PROPIO, company: { name: 'Sur' } },
      { ...DE_PLATAFORMA, company: null, affectedCompanyIds: ['c1', 'c2'] },
    ]);
    const prisma = { raw: { providerIncident: { findMany } } } as unknown as PrismaService;
    const rows = await new AlertsQueryService(prisma).listForPlatform(NOW);

    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { resolvedAt: null },
        { resolvedAt: { gte: new Date(NOW.getTime() - 7 * 86_400_000) } },
      ],
    });
    expect(rows[0]).toMatchObject({ companyName: 'Sur', affectedCompanies: 1 });
    expect(rows[1]).toMatchObject({ companyName: null, affectedCompanies: 2 });
  });
});
```

```ts
// src/alerts/alerts-routes.spec.ts
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CompanyGuard } from '../auth/guards/company.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { PlatformController } from '../platform/platform.controller';
import { PanelAlertsController } from './panel-alerts.controller';

describe('rutas de alertas', () => {
  it('/panel/alerts va detrás del guard de empresa', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PanelAlertsController)).toBe('panel/alerts');
    expect(Reflect.getMetadata(GUARDS_METADATA, PanelAlertsController)).toContain(CompanyGuard);
  });

  it('/platform/incidents queda detrás del guard de administradores', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PlatformController.prototype.listIncidents),
    ).toBe('incidents');
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformController)).toContain(
      PlatformAdminGuard,
    );
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npx jest src/alerts/alerts-query.service.spec.ts src/alerts/alerts-routes.spec.ts`
Esperado: FALLA con "Cannot find module" o `listIncidents` indefinido.

- [ ] **Paso 3: Implementar**

```ts
// src/alerts/alerts-query.service.ts
import { Injectable } from '@nestjs/common';
import type { ProviderIncident } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { providerLabel } from './alerts.types';

export interface OwnAlert {
  id: string;
  service: string;
  provider: string;
  providerLabel: string;
  reason: string;
  hint: string | null;
  openedAt: Date;
  failureCount: number;
}

/** Sin `providerLabel`/`reason`/`hint`/`failureCount` para un usuario normal. */
export interface PlatformAlert {
  id: string;
  service: string;
  openedAt: Date;
  providerLabel?: string;
  reason?: string;
  hint?: string | null;
  failureCount?: number;
}

export interface PanelAlerts {
  own: OwnAlert[];
  platform: PlatformAlert[];
}

export interface PlatformIncidentRow {
  id: string;
  scope: string;
  service: string;
  provider: string;
  providerLabel: string;
  companyName: string | null;
  kind: string;
  reason: string;
  hint: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  failureCount: number;
  affectedCompanies: number;
}

const DAY_MS = 86_400_000;

function detalle(i: ProviderIncident): OwnAlert {
  return {
    id: i.id,
    service: i.service,
    provider: i.provider,
    providerLabel: providerLabel(i.provider),
    reason: i.reason,
    hint: i.hint,
    openedAt: i.openedAt,
    failureCount: i.failureCount,
  };
}

/**
 * Lecturas de incidentes. Todo por `raw` (la tabla queda fuera del
 * aislamiento automático: los de plataforma no son de ninguna empresa), así
 * que cada consulta filtra la empresa A MANO. Un usuario normal nunca recibe
 * el detalle interno de un incidente de plataforma.
 */
@Injectable()
export class AlertsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lo que ve el aviso del panel para la empresa activa. */
  async forCompany(companyId: string, userId: string): Promise<PanelAlerts> {
    const admin = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true },
    });
    const isAdmin = admin?.isPlatformAdmin === true;
    const own = await this.prisma.raw.providerIncident.findMany({
      where: { companyId, scope: 'company', resolvedAt: null },
      orderBy: { openedAt: 'asc' },
    });
    const platform = await this.prisma.raw.providerIncident.findMany({
      where: {
        scope: 'platform',
        resolvedAt: null,
        ...(isAdmin ? {} : { affectedCompanyIds: { has: companyId } }),
      },
      orderBy: { openedAt: 'asc' },
    });
    return {
      own: own.map(detalle),
      platform: platform.map((i) =>
        isAdmin
          ? detalle(i)
          : { id: i.id, service: i.service, openedAt: i.openedAt },
      ),
    };
  }

  /** Mantenedor: abiertos y cerrados en los últimos 7 días. */
  async listForPlatform(now = new Date()): Promise<PlatformIncidentRow[]> {
    const rows = await this.prisma.raw.providerIncident.findMany({
      where: {
        OR: [
          { resolvedAt: null },
          { resolvedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
        ],
      },
      orderBy: { openedAt: 'desc' },
      take: 200,
      include: { company: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      service: r.service,
      provider: r.provider,
      providerLabel: providerLabel(r.provider),
      companyName: r.company?.name ?? null,
      kind: r.kind,
      reason: r.reason,
      hint: r.hint,
      openedAt: r.openedAt,
      resolvedAt: r.resolvedAt,
      failureCount: r.failureCount,
      affectedCompanies: r.affectedCompanyIds.length,
    }));
  }
}
```

Nota sobre el test de `forCompany`: el mock de `findMany` devuelve en orden los propios y luego los de plataforma, y la implementación los consulta en ese mismo orden (secuencial, no `Promise.all`). No cambiar el orden.

```ts
// src/alerts/panel-alerts.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../auth/guards/company.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { TenantContext } from '../common/tenant/tenant-context';
import { AlertsQueryService } from './alerts-query.service';

/** Avisos de proveedores para la empresa activa (cualquier rol). */
@Controller('panel/alerts')
@UseGuards(JwtAuthGuard, CompanyGuard, RolesGuard)
export class PanelAlertsController {
  constructor(private readonly alerts: AlertsQueryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.alerts.forCompany(TenantContext.requireCompanyId(), user.userId);
  }
}
```

`src/alerts/alerts.module.ts`: agregar `controllers: [PanelAlertsController]` y `AlertsQueryService` en `providers` y en `exports`.

`src/platform/platform.controller.ts`: importar `AlertsQueryService`, agregarlo al constructor (`private readonly alerts: AlertsQueryService`) y el endpoint:

```ts
  /** Incidentes de proveedores: abiertos y cerrados en los últimos 7 días. */
  @Get('incidents')
  listIncidents() {
    return this.alerts.listForPlatform();
  }
```

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Correr: `npx jest src/alerts src/platform`
Esperado: PASA.

- [ ] **Paso 5: Checkpoint (sin commit)**

Correr: `npx eslint src/alerts src/platform && npm run build`
Esperado: sin errores.

---

### Tarea 8: Frontend: aviso en el panel

**Archivos:**
- Crear: `frontend/src/components/ProviderAlerts.tsx`
- Modificar:
  - `frontend/src/types.ts`
  - `frontend/src/components/AppLayout.tsx`: insertar sobre `<main>`.
  - `frontend/src/i18n/locales/es.json` y `en.json`: bloque `alerts`.

**Interfaces:**
- Consume: `GET /panel/alerts` (Tarea 7); `ChannelIcon` de `components/channels.tsx`; `AgentsIcon` de `components/icons.tsx`.
- Produce: tipos `AlertService`, `OwnAlert`, `PlatformAlert`, `PanelAlerts` y `PlatformIncidentRow` en `types.ts`; el componente `ProviderAlerts`; las claves i18n `alerts.*`.

- [ ] **Paso 1: Tipos**

Al final de `frontend/src/types.ts`:

```ts
/** Canal cuyo proveedor se vigila (alertas de proveedores). */
export type AlertService = 'whatsapp' | 'email' | 'voice' | 'llm';

export interface OwnAlert {
  id: string;
  service: AlertService;
  provider: string;
  providerLabel: string;
  reason: string;
  hint: string | null;
  openedAt: string;
  failureCount: number;
}

/** Sin detalle para un usuario normal; con detalle para un administrador. */
export interface PlatformAlert {
  id: string;
  service: AlertService;
  openedAt: string;
  providerLabel?: string;
  reason?: string;
  hint?: string | null;
  failureCount?: number;
}

export interface PanelAlerts {
  own: OwnAlert[];
  platform: PlatformAlert[];
}

export interface PlatformIncidentRow {
  id: string;
  scope: 'company' | 'platform';
  service: AlertService;
  provider: string;
  providerLabel: string;
  companyName: string | null;
  kind: string;
  reason: string;
  hint: string | null;
  openedAt: string;
  resolvedAt: string | null;
  failureCount: number;
  affectedCompanies: number;
}
```

- [ ] **Paso 2: Textos**

En `es.json`, un bloque nuevo de primer nivel `"alerts"`:

```json
"alerts": {
  "problem": {
    "whatsapp": "WhatsApp no está enviando mensajes",
    "email": "El correo no está enviando mensajes",
    "voice": "Las llamadas no se están iniciando",
    "llm": "La IA no está respondiendo"
  },
  "platformProblem": {
    "whatsapp": "WhatsApp tiene un problema de nuestra parte; ya lo estamos revisando.",
    "email": "El correo tiene un problema de nuestra parte; ya lo estamos revisando.",
    "voice": "Las llamadas tienen un problema de nuestra parte; ya lo estamos revisando.",
    "llm": "El asistente tiene un problema de nuestra parte; ya lo estamos revisando."
  },
  "service": { "whatsapp": "WhatsApp", "email": "Correo", "voice": "Llamadas", "llm": "IA" },
  "platformTag": "Plataforma",
  "sinceMinutes_one": "Desde hace {{count}} minuto",
  "sinceMinutes_other": "Desde hace {{count}} minutos",
  "sinceHours_one": "Desde hace {{count}} hora",
  "sinceHours_other": "Desde hace {{count}} horas",
  "sinceDays_one": "Desde hace {{count}} día",
  "sinceDays_other": "Desde hace {{count}} días",
  "failures_one": "{{count}} envío fallido",
  "failures_other": "{{count}} envíos fallidos",
  "goIntegrations": "Ver integraciones",
  "goPlatform": "Ver incidentes"
}
```

En `en.json`:

```json
"alerts": {
  "problem": {
    "whatsapp": "WhatsApp isn't sending messages",
    "email": "Email isn't sending messages",
    "voice": "Calls aren't starting",
    "llm": "The AI isn't responding"
  },
  "platformProblem": {
    "whatsapp": "WhatsApp has a problem on our side; we're already looking into it.",
    "email": "Email has a problem on our side; we're already looking into it.",
    "voice": "Calls have a problem on our side; we're already looking into it.",
    "llm": "The assistant has a problem on our side; we're already looking into it."
  },
  "service": { "whatsapp": "WhatsApp", "email": "Email", "voice": "Calls", "llm": "AI" },
  "platformTag": "Platform",
  "sinceMinutes_one": "For {{count}} minute",
  "sinceMinutes_other": "For {{count}} minutes",
  "sinceHours_one": "For {{count}} hour",
  "sinceHours_other": "For {{count}} hours",
  "sinceDays_one": "For {{count}} day",
  "sinceDays_other": "For {{count}} days",
  "failures_one": "{{count}} failed send",
  "failures_other": "{{count}} failed sends",
  "goIntegrations": "View integrations",
  "goPlatform": "View incidents"
}
```

Insertarlos con un script en Python, como se hizo con `managedVoice`: cargar el JSON, asignar `d['alerts'] = {...}`, volcarlo con `json.dumps(d, ensure_ascii=False, indent=2) + '\n'` y respetar el fin de línea del archivo. Verificar con `git diff --stat` que solo cambia lo agregado.

Limitación conocida: `reason` y `hint` vienen del backend en español. En la interfaz en inglés se muestran en español.

- [ ] **Paso 3: Componente**

```tsx
// frontend/src/components/ProviderAlerts.tsx
import { WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { AlertService, PanelAlerts } from '../types';
import { ChannelIcon } from './channels';
import { AgentsIcon } from './icons';
import { cn } from './ui';

/** Ícono del canal; la IA usa el del robot (agentes). */
function ServiceIcon({ service }: { service: AlertService }) {
  if (service === 'llm') {
    return <AgentsIcon aria-hidden="true" className="h-4 w-4 shrink-0" />;
  }
  return (
    <ChannelIcon
      channel={service === 'voice' ? 'call' : service}
      className="h-4 w-4"
    />
  );
}

/** "Desde hace 5 minutos / 2 horas / 3 días". */
function useSince() {
  const { t } = useTranslation();
  return (iso: string) => {
    const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 60) return t('alerts.sinceMinutes', { count: min });
    const hours = Math.floor(min / 60);
    if (hours < 48) return t('alerts.sinceHours', { count: hours });
    return t('alerts.sinceDays', { count: Math.floor(hours / 24) });
  };
}

/**
 * Avisos de proveedores caídos, sobre todas las páginas. Rojo si la cuenta es
 * de la empresa (o si quien mira es administrador); ámbar, sin detalles, si
 * el problema es de la plataforma. Se cierran solos cuando el proveedor
 * vuelve a funcionar. Si la consulta falla (por ejemplo, un backend todavía
 * sin este endpoint), no muestra nada: un aviso no debe tapar el panel.
 */
export function ProviderAlerts({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const since = useSince();
  const { data } = usePolling<PanelAlerts>(
    () => api.get<PanelAlerts>('/panel/alerts').then((r) => r.data),
    60_000,
    [companyId],
  );
  if (!data || (data.own.length === 0 && data.platform.length === 0)) {
    return null;
  }

  const rojos = [
    ...data.own.map((a) => ({ ...a, platform: false })),
    ...data.platform
      .filter((a) => a.reason)
      .map((a) => ({ ...a, platform: true })),
  ];
  const ambar = data.platform.filter((a) => !a.reason);

  return (
    <div className="space-y-2 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
      {rojos.map((a) => (
        <div
          key={a.id}
          role="alert"
          className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          <WarningCircle weight="fill" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">
              <ServiceIcon service={a.service} />
              {t(`alerts.problem.${a.service}`)}
              {a.platform && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium">
                  {t('alerts.platformTag')}
                </span>
              )}
            </p>
            <p className="mt-0.5">
              {a.providerLabel}: {a.reason}
              {a.hint ? ` ${a.hint}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-rose-600">
              {since(a.openedAt)}
              {a.failureCount !== undefined &&
                ` · ${t('alerts.failures', { count: a.failureCount })}`}
            </p>
          </div>
          <Link
            to={a.platform ? '/platform' : '/integrations'}
            className="self-center whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-rose-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            {a.platform ? t('alerts.goPlatform') : t('alerts.goIntegrations')}
          </Link>
        </div>
      ))}
      {ambar.map((a) => (
        <div
          key={a.id}
          role="status"
          className={cn(
            'flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800',
          )}
        >
          <ServiceIcon service={a.service} />
          <p>{t(`alerts.platformProblem.${a.service}`)}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Paso 4: Insertarlo en `AppLayout`**

En `frontend/src/components/AppLayout.tsx`, importar `import { ProviderAlerts } from './ProviderAlerts';`. Justo **antes** del comentario `{/* Contenido. El \`h-full\` …` que precede a `<main …>`, agregar:

```tsx
        {selectedCompanyId && <ProviderAlerts companyId={selectedCompanyId} />}
```

- [ ] **Paso 5: Compilar (checkpoint, sin commit)**

Correr: `cd frontend && pnpm build`
Esperado: `✓ built`, sin errores de TypeScript.

---

### Tarea 9: Frontend: sección "Incidentes" en Plataforma

**Archivos:**
- Crear: `frontend/src/components/IncidentsCard.tsx`
- Modificar:
  - `frontend/src/pages/PlatformPage.tsx`: renderizar la tarjeta después de la tabla de empresas.
  - `frontend/src/i18n/locales/es.json` y `en.json`: claves `platform.incidents*`.

**Interfaces:**
- Consume: `GET /platform/incidents` (Tarea 7); `PlatformIncidentRow`, `ChannelIcon`, `AgentsIcon` y las claves `alerts.service.*` (Tarea 8).
- Produce: `IncidentsCard`.

- [ ] **Paso 1: Textos**

Agregar dentro del bloque `platform` de `es.json`:

```json
"incidentsTitle": "Incidentes de proveedores",
"incidentsSubtitle": "Abiertos y cerrados en los últimos 7 días.",
"incidentsEmpty": "Sin incidentes en los últimos 7 días.",
"incidentsError": "No se pudieron cargar los incidentes.",
"incColStatus": "Estado",
"incColService": "Canal",
"incColAccount": "Cuenta",
"incColReason": "Motivo",
"incColSince": "Desde",
"incColDuration": "Duración",
"incColFailures": "Fallos",
"incColAffected": "Empresas",
"incOpen": "Abierto",
"incResolved": "Cerrado",
"incOngoing": "en curso",
"incAccountPlatform": "Plataforma",
"incDurationMinutes": "{{count}} min",
"incDurationHours": "{{count}} h",
"incDurationDays_one": "{{count}} día",
"incDurationDays_other": "{{count}} días"
```

Y en `en.json`:

```json
"incidentsTitle": "Provider incidents",
"incidentsSubtitle": "Open and closed in the last 7 days.",
"incidentsEmpty": "No incidents in the last 7 days.",
"incidentsError": "Couldn't load the incidents.",
"incColStatus": "Status",
"incColService": "Channel",
"incColAccount": "Account",
"incColReason": "Reason",
"incColSince": "Since",
"incColDuration": "Duration",
"incColFailures": "Failures",
"incColAffected": "Companies",
"incOpen": "Open",
"incResolved": "Closed",
"incOngoing": "ongoing",
"incAccountPlatform": "Platform",
"incDurationMinutes": "{{count}} min",
"incDurationHours": "{{count}} h",
"incDurationDays_one": "{{count}} day",
"incDurationDays_other": "{{count}} days"
```

- [ ] **Paso 2: Componente**

```tsx
// frontend/src/components/IncidentsCard.tsx
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { AlertService, PlatformIncidentRow } from '../types';
import { ChannelIcon } from './channels';
import { AgentsIcon } from './icons';
import { Badge, Card } from './ui';

function ServiceCell({ service }: { service: AlertService }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      {service === 'llm' ? (
        <AgentsIcon aria-hidden="true" className="h-4 w-4" />
      ) : (
        <ChannelIcon channel={service === 'voice' ? 'call' : service} className="h-4 w-4" />
      )}
      {t(`alerts.service.${service}`)}
    </span>
  );
}

/** Incidentes de proveedores de todas las empresas y de la plataforma. */
export function IncidentsCard() {
  const { t, i18n } = useTranslation();
  const { data, error } = usePolling<PlatformIncidentRow[]>(
    () => api.get<PlatformIncidentRow[]>('/platform/incidents').then((r) => r.data),
    30_000,
  );

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const duracion = (from: string, to: string) => {
    const min = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
    if (min < 60) return t('platform.incDurationMinutes', { count: min });
    const hours = Math.floor(min / 60);
    if (hours < 48) return t('platform.incDurationHours', { count: hours });
    return t('platform.incDurationDays', { count: Math.floor(hours / 24) });
  };

  return (
    <Card className="mt-6 overflow-x-auto p-0">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{t('platform.incidentsTitle')}</h2>
        <p className="text-xs text-slate-500">{t('platform.incidentsSubtitle')}</p>
      </div>
      {error && !data ? (
        <p className="px-4 py-6 text-sm text-rose-600">{t('platform.incidentsError')}</p>
      ) : !data ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t('common.loading')}</p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{t('platform.incidentsEmpty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">{t('platform.incColStatus')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColService')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColAccount')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColReason')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColSince')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColDuration')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColFailures')}</th>
              <th className="px-4 py-2 font-medium">{t('platform.incColAffected')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-4 py-2">
                  {r.resolvedAt ? (
                    <Badge tone="slate">{t('platform.incResolved')}</Badge>
                  ) : (
                    <Badge className="bg-rose-50 text-rose-600">{t('platform.incOpen')}</Badge>
                  )}
                </td>
                <td className="px-4 py-2"><ServiceCell service={r.service} /></td>
                <td className="px-4 py-2 text-slate-700">
                  {r.companyName ?? t('platform.incAccountPlatform')}
                  <div className="text-xs text-slate-400">{r.providerLabel}</div>
                </td>
                <td className="max-w-xs px-4 py-2 text-slate-700">
                  {r.reason}
                  {r.hint && <div className="text-xs text-slate-400">{r.hint}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fecha(r.openedAt)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                  {r.resolvedAt ? duracion(r.openedAt, r.resolvedAt) : t('platform.incOngoing')}
                </td>
                <td className="px-4 py-2 text-slate-600">{r.failureCount}</td>
                <td className="px-4 py-2 text-slate-600">
                  {r.scope === 'platform' ? r.affectedCompanies : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

Si `Badge` no acepta `tone="slate"`, revisar `BADGE_TONES` en `components/ui.tsx` y usar el tono neutro que exista.

- [ ] **Paso 3: Renderizarlo en `PlatformPage`**

En `frontend/src/pages/PlatformPage.tsx`, importar `import { IncidentsCard } from '../components/IncidentsCard';` y renderizar `<IncidentsCard />` justo después del bloque condicional de la tabla de empresas (el `{!companies ? … : …}`), dentro del `<div className="p-4 md:p-6">`.

- [ ] **Paso 4: Compilar (checkpoint, sin commit)**

Correr: `cd frontend && pnpm build`
Esperado: `✓ built`.

---

### Tarea 10: Documentación, arranque real y revisión en el navegador

**Archivos:**
- Modificar:
  - `docs/DESPLIEGUE.md`: sección nueva al final.
  - `docs/PANEL.md` y `docs/PANEL.en.md`: avisos y la sección de Plataforma.
  - `docs/superpowers/specs/2026-10-08-alertas-proveedores-design.md`: los dos ajustes de "Restricciones globales".
- Crear: `<scratchpad>/mock-alerts.cjs`, servidor de prueba que no va al repo.

- [ ] **Paso 1: Documentación**

`docs/DESPLIEGUE.md`, al final:

```markdown
## Alertas de proveedores (2026-10-08)

Si un proveedor deja de funcionar (WhatsApp, correo, voz o IA), se abre un
incidente y se avisa a quien debe arreglarlo: al dueño de la empresa si la
cuenta es suya, o a los administradores de la plataforma si es de la
plataforma. Spec: `docs/superpowers/specs/2026-10-08-alertas-proveedores-design.md`.

- **Migración nueva: `provider_incidents`** (tabla `ProviderIncident`). Se
  aplica sola al arrancar.
- **Sin variables nuevas.** Los correos salen por el correo del sistema
  (`EMAIL_PROVIDER`/`EMAIL_FROM`, el mismo de "recuperar contraseña"), con
  enlaces a `PANEL_URL`.
- **Cuándo se abre:** al primer error de cuenta (sin saldo, clave inválida,
  cuenta suspendida) o a los 3 errores pasajeros seguidos en 15 min. Los
  errores de un mensaje puntual (teléfono inválido) no abren nada.
- **Cuándo se cierra:** con el primer envío exitoso por esa cuenta.
- **Correos:** uno al abrirse (como máximo uno cada 6 h por proveedor) y uno
  al cerrarse.
- **Endpoints:** `GET /panel/alerts` (aviso del panel) y
  `GET /platform/incidents` (mantenedor).
```

En `docs/PANEL.md`, en la sección de Integraciones o en una sección general, agregar un párrafo:

```markdown
**Avisos de proveedores.** Si WhatsApp, el correo, las llamadas o la IA dejan
de funcionar, aparece un aviso arriba en todas las páginas: rojo si el problema
es de tu cuenta (dice el motivo y qué hacer, por ejemplo "Recarga saldo en
YCloud"), ámbar si es de nuestra parte. Al dueño le llega además un correo. El
aviso se cierra solo cuando el proveedor vuelve a funcionar.
```

En la sección de Plataforma:

```markdown
La sección **Incidentes de proveedores** lista los abiertos y los cerrados de
los últimos 7 días, de todas las empresas y de la plataforma: canal, cuenta,
motivo, desde cuándo, duración, fallos y empresas afectadas.
```

Hacer lo equivalente en inglés en `docs/PANEL.en.md`. Correr `npm run sync:guides`.

En el spec:
- **Sección 6:** reemplazar los puntos de Redis `provider-health:open:` y `provider-health:mail:` por: "El incidente abierto se busca por `openKey` y el límite de correos por `key`, en la base de datos; Redis queda solo para la racha".
- **Sección 10:** cambiar "Sin `PANEL_URL`: el correo sale sin enlace" por: "Enlace con la misma URL que el correo de contraseña (`PANEL_URL`, si no `CORS_ORIGIN`)".

- [ ] **Paso 2: Verificación completa del backend**

Correr: `npx eslint src && npm run build && npx jest`
Esperado: eslint con salida 0, build OK y toda la suite en verde. Anotar el número de tests.

- [ ] **Paso 3: Arranque real (detecta errores de cableado de Nest que los tests no ven)**

```bash
docker compose up -d postgres redis
npx prisma migrate deploy
npm run build
timeout 60 node dist/main > "$TMPDIR/arranque.log" 2>&1; grep -E "Nest application successfully started|Error|cannot resolve|Nest can't resolve" "$TMPDIR/arranque.log" | head
```

Esperado: aparece `Nest application successfully started` y ningún `Nest can't resolve dependencies`. `migrate deploy` aplica `20261008120000_provider_incidents` sin errores. Después: `docker compose stop postgres redis`.

- [ ] **Paso 4: Revisión en el navegador con el servidor de prueba**

Crear `<scratchpad>/mock-alerts.cjs`: un servidor HTTP en el puerto 3997 que devuelva:
- `/auth/me`: usuario con `isPlatformAdmin: true`.
- `/panel/alerts`:
  - `own`: un incidente de WhatsApp/YCloud, "La cuenta de YCloud no tiene saldo.", hint "Recarga saldo en YCloud.", `failureCount` 14, `openedAt` hace 2 h.
  - `platform`: uno con detalle (ElevenLabs, "La cuenta de Twilio está suspendida o inactiva.") y uno sin detalle (`{ id, service: 'llm', openedAt }`).
  - Con la variable de entorno `FALLA=1`, debe responder **404** en `/panel/alerts`.
- `/platform/incidents`: una fila abierta y una cerrada.
- `/platform/companies`: `[]`.

El modelo a seguir es `mock-agents.cjs`, con el mismo manejo de CORS.

Levantar el frontend con `VITE_API_URL=http://localhost:3997 pnpm exec vite --port 5199 --strictPort` y abrir el panel con la sesión de prueba en `localStorage` (`agentes-lead-auth`).

Verificar:
- Aviso rojo con el motivo, "Desde hace 2 horas · 14 envíos fallidos" y "Ver integraciones".
- El rojo de plataforma con la etiqueta "Plataforma".
- El ámbar de la IA.
- La sección "Incidentes de proveedores" en `/platform`.
- En celular (375 px): sin scroll horizontal.
- Con `FALLA=1`, el panel se ve normal y sin aviso (punto 5 de "Puntos a revisar").

Al terminar, detener los servidores y volver el navegador a escritorio.

- [ ] **Paso 5: Cierre (sin commit)**

Reportar al usuario:
- Qué se hizo y cómo se verificó.
- El número de tests.
- El resultado del arranque real.
- Capturas.

Recordar que no hay commit ni deploy, y que el deploy incluye la migración `provider_incidents`.
