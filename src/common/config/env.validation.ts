import { z } from 'zod';

/**
 * Esquema de variables de entorno. Se valida al arrancar (fail-fast): si algo
 * falta o es inválido, el proceso no levanta. Así evitamos arrancar a medias.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().url().startsWith('postgresql'),
    REDIS_URL: z.string().url().startsWith('redis'),

    // Clave de cifrado en reposo: 32 bytes en hex (64 chars) o base64 de 32 bytes.
    ENCRYPTION_KEY: z.string().refine((v) => decodeKeyLength(v) === 32, {
      message:
        'ENCRYPTION_KEY debe representar exactamente 32 bytes (64 hex chars o base64 de 32 bytes)',
    }),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    // Orígenes permitidos por CORS (coma-separados). Vacío = refleja cualquiera
    // (útil en dev). En producción, fija el dominio del panel (Vercel).
    CORS_ORIGIN: z.string().optional(),
    // URL pública del panel, para los enlaces en correos (recuperar
    // contraseña). Si falta, se usa el primer origen de CORS_ORIGIN.
    PANEL_URL: z.string().url().optional(),
    // URL pública del backend, la que se muestra en Integraciones para que el
    // cliente la pegue como webhook en YCloud/Meta/Retell/Vapi. Si falta, se
    // deduce de la petición del panel (sirve tal cual en Railway o Cloud Run).
    PUBLIC_API_URL: z.string().url().optional(),

    // ── Embeddings (base de conocimiento) ──
    // 'local' = embedder determinista sin API key (dev). 'voyage' = Voyage AI.
    EMBEDDINGS_PROVIDER: z.enum(['local', 'voyage']).default('local'),
    EMBEDDINGS_MODEL: z.string().default('voyage-3.5'),
    // Debe coincidir con la dimensión de la columna vector en la BD (1024).
    EMBEDDINGS_DIMENSION: z.coerce.number().int().positive().default(1024),
    VOYAGE_API_KEY: z.string().optional(),

    // ── Agente / LLM (Fase 3) ──
    // La key es opcional al arrancar; sin ella el agente degrada a escalamiento.
    ANTHROPIC_API_KEY: z.string().optional(),
    // Por defecto sonnet-5. Para alto volumen se puede usar 'claude-sonnet-5'.
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
    // Modelo para tareas de fondo simples (resumen de memoria, elegir agente).
    // Vacío = el mismo ANTHROPIC_MODEL. Debe aceptar `effort` (p. ej.
    // claude-haiku-5-5); Haiku 4.5 no lo acepta y respondería 400.
    ANTHROPIC_BACKGROUND_MODEL: z.string().optional(),
    ANTHROPIC_EFFORT: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max'])
      .default('medium'),
    ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    // Guardas del bucle de decisión.
    AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
    AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    // Ventana de agrupacion de mensajes entrantes: el turno espera este tiempo
    // antes de correr, y si el cliente escribe de nuevo dentro de la ventana se
    // contesta todo junto (en vez de una respuesta por mensaje). 0 = sin espera.
    AGENT_TURN_DEBOUNCE_MS: z.coerce.number().int().min(0).default(8000),

    // ── WhatsApp (Fase 3) ──
    // 'log' = registra los envíos (dev). 'meta' = Cloud API. 'ycloud' = BSP YCloud.
    WHATSAPP_PROVIDER: z.enum(['log', 'meta', 'ycloud']).default('log'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    // Token de verificación del webhook de Meta (GET hub.verify_token).
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    // YCloud (proveedor alternativo). `YCLOUD_FROM` = número de negocio E.164.
    YCLOUD_API_KEY: z.string().optional(),
    YCLOUD_FROM: z.string().optional(),
    // WhatsApp Business Account ID en YCloud (para crear/gestionar plantillas
    // desde el panel). Se obtiene del dashboard de YCloud.
    YCLOUD_WABA_ID: z.string().optional(),

    // ── Panel / Auth (Fase 7A) ──
    JWT_SECRET: z
      .string()
      .min(
        32,
        "JWT_SECRET debe tener al menos 32 caracteres. Genera uno con: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"",
      ),
    JWT_EXPIRES_IN: z.string().default('8h'),

    // Exige `X-Timestamp` en los webhooks firmados de entrada (firma v2, con
    // protección contra repetición). false mientras migras los flujos de n8n
    // al esquema nuevo; después, true.
    WEBHOOK_REQUIRE_TIMESTAMP: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // ── Seguimiento automático (Fase 4) ──
    // Defaults globales de la empresa; cada Agent puede pisar escalera/delays/
    // tope/plantillas vía Agent.followupConfig (ver agents/followup-config.ts).
    FOLLOWUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    FOLLOWUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(4),
    FOLLOWUP_BASE_DELAY_HOURS: z.coerce.number().int().positive().default(24),
    // Espaciado explícito entre intentos, en horas (coma-separado). El índice es
    // el intento ejecutado: [tras #1, tras #2, tras #3, …]. Default: 2º toque a
    // las 12h, luego 48h y 72h. Si un intento supera la lista, cae al espaciado
    // creciente `FOLLOWUP_BASE_DELAY_HOURS * intento`.
    FOLLOWUP_DELAYS_HOURS: z.string().default('12,48,72'),
    // Minutos de espera antes del primer contacto de un lead nuevo (0 = casi
    // inmediato). Responder rápido sin parecer un bot instantáneo.
    FOLLOWUP_FIRST_CONTACT_DELAY_MIN: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5),
    // Escalera de canales del seguimiento (coma-separado): email|whatsapp|call.
    // El índice es el intento; cicla si hay más intentos que canales.
    FOLLOWUP_CHANNEL_LADDER: z
      .string()
      .default('email,whatsapp,whatsapp,email'),
    // Plantilla (HSM) aprobada para iniciar WhatsApp fuera de la ventana de 24h.
    // Vacío = sin plantilla (el agente cae a correo cuando la ventana está
    // cerrada). Debe existir/estar aprobada en el proveedor (YCloud/Meta) con
    // DOS variables de cuerpo: {{1}} = nombre del lead, {{2}} = nombre de la
    // empresa (tenant). El LANG debe calzar con el idioma de la plantilla.
    FOLLOWUP_WHATSAPP_TEMPLATE: z.string().default(''),
    FOLLOWUP_WHATSAPP_TEMPLATE_LANG: z.string().default('es'),

    // ── Correo (Fase 5) ──
    // 'log' = consola (dev). 'smtp' = SMTP. 'resend' = API HTTP de Resend
    // (recomendado en la nube: los PaaS suelen bloquear SMTP).
    EMAIL_PROVIDER: z.enum(['log', 'smtp', 'resend']).default('log'),
    EMAIL_FROM: z
      .string()
      .default('Agentes Lead <no-reply@agentes-lead.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    // Resend (si EMAIL_PROVIDER=resend). El `from` sale de EMAIL_FROM.
    // También es la cuenta del correo gestionado de las empresas: para dar de
    // alta sus dominios necesita permiso "Full access".
    RESEND_API_KEY: z.string().optional(),

    // ── Correo gestionado (cuenta de Resend de la plataforma) ──
    // Dominio de la plataforma, verificado en Resend, desde el que envía una
    // empresa mientras verifica el suyo (p. ej. "correo.tuplataforma.cl"). Sin
    // él, una empresa sin dominio propio verificado no envía correos.
    EMAIL_SHARED_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'dominio inválido')
      .optional(),
    // Parte local de la dirección compartida: notificaciones@EMAIL_SHARED_DOMAIN.
    EMAIL_SHARED_LOCAL_PART: z.string().default('notificaciones'),
    // Tope diario (día UTC) de correos por empresa que salen por la cuenta de
    // la plataforma. Protege la cuenta de Resend, que comparten todas.
    EMAIL_DAILY_LIMIT_PER_COMPANY: z.coerce
      .number()
      .int()
      .positive()
      .default(500),
    // Región de envío de los dominios que se dan de alta (sa-east-1 = São Paulo).
    RESEND_DOMAIN_REGION: z
      .enum(['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1'])
      .default('sa-east-1'),

    // ── Voz gestionada (cuentas de Twilio y ElevenLabs de la plataforma) ──
    // Las empresas sin cuenta de voz propia llaman por acá: un agente de
    // ElevenLabs por tipo, compartido, y un número de la plataforma. Se activa
    // con la API key, el número, el agente por defecto y el secreto del webhook.
    ELEVENLABS_API_KEY: z.string().optional(),
    // Número de la plataforma importado en ElevenLabs (Twilio o SIP trunk).
    ELEVENLABS_PHONE_NUMBER_ID: z.string().optional(),
    // Agente para los agentes de tipo COBRANZA; si falta, se usa el por defecto.
    ELEVENLABS_AGENT_ID_COBRANZA: z.string().optional(),
    // Agente para el resto de los tipos (ventas, soporte, agendamiento…).
    ELEVENLABS_AGENT_ID_DEFAULT: z.string().optional(),
    // Secreto HMAC del webhook post-llamada del workspace de la plataforma.
    ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
    // Minutos al mes por empresa si la plataforma no le fijó otro tope.
    // 0 = sin voz gestionada hasta que se le asignen minutos.
    VOICE_MONTHLY_MINUTES_DEFAULT: z.coerce.number().int().min(0).default(0),
    // Llamadas simultáneas por empresa: el plan de ElevenLabs tiene un máximo
    // compartido por todas, y una campaña de un cliente no puede tomarlo entero.
    VOICE_MAX_CONCURRENT_PER_COMPANY: z.coerce
      .number()
      .int()
      .positive()
      .default(2),

    // ── Llamadas de voz (Fase 5) ──
    // 'log' = stub sin llamada real (dev). 'vapi' = Vapi.ai. 'retell' = Retell AI
    // (agente de voz; el número lo provee Twilio importado en Retell).
    VOICE_PROVIDER: z.enum(['log', 'vapi', 'retell']).default('log'),
    // Vapi (si VOICE_PROVIDER=vapi).
    VAPI_API_KEY: z.string().optional(),
    VAPI_PHONE_NUMBER_ID: z.string().optional(),
    VAPI_ASSISTANT_ID: z.string().optional(),
    // Retell (si VOICE_PROVIDER=retell). RETELL_FROM_NUMBER = número de Twilio
    // importado en Retell (E.164). RETELL_AGENT_ID = agente de voz a usar.
    RETELL_API_KEY: z.string().optional(),
    RETELL_FROM_NUMBER: z.string().optional(),
    RETELL_AGENT_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Si se usa Voyage, la API key es obligatoria.
    if (env.EMBEDDINGS_PROVIDER === 'voyage' && !env.VOYAGE_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOYAGE_API_KEY'],
        message:
          'VOYAGE_API_KEY es obligatoria cuando EMBEDDINGS_PROVIDER=voyage',
      });
    }
    // Nota: las credenciales de WhatsApp/correo/voz YA NO se validan aquí —
    // ahora cada empresa las configura en el panel (BYO, cifradas en reposo).
    // Ver `IntegrationsModule` / `CredentialsService`.
  });

/** Tipo fuerte de la configuración validada, usado por `ConfigService`. */
export type EnvVars = z.infer<typeof envSchema>;

/** Intenta decodificar la clave (hex primero, luego base64) y devolver su largo. */
function decodeKeyLength(value: string): number {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return value.length / 2;
  }
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return -1;
  }
}

/**
 * Función `validate` que consume `@nestjs/config`. Lanza si el entorno es
 * inválido, con un mensaje legible listando cada problema.
 */
export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detalles = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detalles}`);
  }
  return parsed.data;
}
