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
    // Por defecto opus-5. Para alto volumen se puede usar 'claude-sonnet-5'.
    ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
    ANTHROPIC_EFFORT: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max'])
      .default('medium'),
    ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    // Guardas del bucle de decisión.
    AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
    AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

    // ── WhatsApp (Fase 3) ──
    // 'log' = registra los envíos (dev, sin credenciales). 'meta' = Cloud API.
    WHATSAPP_PROVIDER: z.enum(['log', 'meta']).default('log'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    // Token de verificación del webhook de Meta (GET hub.verify_token).
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),

    // ── Panel / Auth (Fase 7A) ──
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
    JWT_EXPIRES_IN: z.string().default('8h'),

    // ── Seguimiento automático (Fase 4) ──
    FOLLOWUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    FOLLOWUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(4),
    FOLLOWUP_BASE_DELAY_HOURS: z.coerce.number().int().positive().default(24),

    // ── Correo (Fase 5) ──
    // 'log' = registra el correo en consola (dev). 'smtp' = envío real.
    EMAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
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

    // ── Llamadas de voz / Vapi (Fase 5) ──
    // 'log' = stub sin llamada real (dev). 'vapi' = Vapi.ai.
    VAPI_PROVIDER: z.enum(['log', 'vapi']).default('log'),
    VAPI_API_KEY: z.string().optional(),
    VAPI_PHONE_NUMBER_ID: z.string().optional(),
    VAPI_ASSISTANT_ID: z.string().optional(),
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
    // Si el correo usa SMTP, se requiere al menos el host.
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST es obligatorio cuando EMAIL_PROVIDER=smtp',
      });
    }
    // Si las llamadas usan Vapi, se requiere la API key.
    if (env.VAPI_PROVIDER === 'vapi' && !env.VAPI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VAPI_API_KEY'],
        message: 'VAPI_API_KEY es obligatoria cuando VAPI_PROVIDER=vapi',
      });
    }
    // Si WhatsApp usa Meta Cloud API, se requieren token y phone number id.
    if (env.WHATSAPP_PROVIDER === 'meta') {
      if (!env.WHATSAPP_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_TOKEN'],
          message:
            'WHATSAPP_TOKEN es obligatorio cuando WHATSAPP_PROVIDER=meta',
        });
      }
      if (!env.WHATSAPP_PHONE_NUMBER_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_PHONE_NUMBER_ID'],
          message:
            'WHATSAPP_PHONE_NUMBER_ID es obligatorio cuando WHATSAPP_PROVIDER=meta',
        });
      }
    }
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
