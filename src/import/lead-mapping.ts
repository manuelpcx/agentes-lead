import { LeadStatus } from '@prisma/client';

/**
 * Traducción entre la exportación de OTRO CRM y nuestra ficha de lead: qué
 * columna es qué, y cómo dejar los valores utilizables (teléfono en E.164,
 * email normalizado, estado del embudo mapeado a nuestro enum).
 *
 * Regla de oro: si un valor no se puede interpretar, NO se inventa — se deja
 * nulo y la fila se reporta como error. Un teléfono adivinado es un mensaje
 * enviado a un desconocido.
 */

/** Campos de la ficha que sabemos llenar desde un CSV. */
export const IMPORT_FIELDS = [
  'name',
  'phone',
  'email',
  'source',
  'campaign',
  'status',
  'externalId',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const FIELD_SET = new Set<string>(IMPORT_FIELDS);
export function isImportField(value: string): value is ImportField {
  return FIELD_SET.has(value);
}

/**
 * Sinónimos de cabecera por campo, en español e inglés, cubriendo lo que
 * exportan HubSpot, Pipedrive, Salesforce, Zoho, Kommo y las planillas hechas
 * a mano. Se comparan normalizados (sin tildes, sin signos, en minúscula).
 */
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  name: [
    'nombre',
    'nombres',
    'nombre completo',
    'nombre y apellido',
    'nombre contacto',
    'contacto',
    'cliente',
    'name',
    'full name',
    'first name',
    'contact name',
    'lead name',
    'person',
  ],
  phone: [
    'telefono',
    'telefono movil',
    'telefono celular',
    'celular',
    'movil',
    'fono',
    'numero',
    'numero de telefono',
    'whatsapp',
    'phone',
    'phone number',
    'mobile',
    'mobile phone',
    'cell',
    'cell phone',
  ],
  email: [
    'email',
    'e mail',
    'correo',
    'correo electronico',
    'mail',
    'email address',
    'work email',
  ],
  source: [
    'origen',
    'fuente',
    'procedencia',
    'canal',
    'source',
    'lead source',
    'original source',
    'channel',
  ],
  campaign: ['campana', 'campaign', 'utm campaign', 'anuncio'],
  status: [
    'estado',
    'etapa',
    'fase',
    'estado del lead',
    'status',
    'stage',
    'deal stage',
    'lifecycle stage',
    'lead status',
  ],
  externalId: [
    'id',
    'id externo',
    'identificador',
    'record id',
    'contact id',
    'lead id',
    'deal id',
    'external id',
  ],
};

/** Minúsculas, sin tildes y sin signos: para comparar cabeceras humanas. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Propone a qué campo corresponde cada cabecera. Devuelve `null` en las que no
 * reconoce — esas no se pierden: van a `metadata.datosOriginales`.
 * Si dos cabeceras apuntan al mismo campo gana la primera (el resto queda
 * `null`), para no tener que resolver el empate a ciegas.
 */
export function suggestMapping(
  headers: string[],
): Record<string, ImportField | null> {
  const mapping: Record<string, ImportField | null> = {};
  const taken = new Set<ImportField>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    let match: ImportField | null = null;
    for (const field of IMPORT_FIELDS) {
      if (taken.has(field)) continue;
      if (HEADER_SYNONYMS[field].includes(normalized)) {
        match = field;
        break;
      }
    }
    mapping[header] = match;
    if (match) taken.add(match);
  }
  return mapping;
}

// ─────────────────────────── teléfonos ───────────────────────────

/** Largo mínimo/máximo de un E.164 sin el "+". */
const E164_MIN = 8;
const E164_MAX = 15;

/** Prefijos país que ofrece el selector del panel. */
export const COUNTRY_PREFIXES = [
  '+56', // Chile
  '+52', // México
  '+57', // Colombia
  '+51', // Perú
  '+54', // Argentina
  '+34', // España
  '+1', // EE.UU. / Canadá
] as const;

/** Prefijo país sugerido a partir de la zona horaria de la empresa. */
export function prefixFromTimezone(
  timezone: string | null | undefined,
): string {
  const map: Record<string, string> = {
    'America/Santiago': '+56',
    'America/Punta_Arenas': '+56',
    'America/Mexico_City': '+52',
    'America/Monterrey': '+52',
    'America/Tijuana': '+52',
    'America/Cancun': '+52',
    'America/Bogota': '+57',
    'America/Lima': '+51',
    'America/Argentina/Buenos_Aires': '+54',
    'Europe/Madrid': '+34',
    'America/New_York': '+1',
  };
  return map[timezone ?? ''] ?? '+56';
}

/**
 * Lleva un teléfono "como lo escribió el otro CRM" a E.164, o devuelve `null`
 * si no hay forma de saberlo con certeza.
 *
 * - "+56 9 1234 5678", "(+56) 9-1234.5678" -> "+56912345678"
 * - "0056912345678" -> "+56912345678" (prefijo internacional a la europea)
 * - "912345678" con prefijo por defecto "+56" -> "+56912345678"
 * - "0912345678" -> se le quita el 0 de larga distancia nacional
 * - "56912345678" (ya trae el país, sin "+") -> "+56912345678"
 * - "1234", "no tiene", "" -> null
 */
export function normalizePhone(
  raw: string,
  defaultPrefix: string,
): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  // Un teléfono no tiene letras; si las trae ("no tiene", "s/n") no es número.
  if (/[a-z]/i.test(text)) return null;

  let digits = text.replace(/[^\d+]/g, '');
  let explicit = false;

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    explicit = true;
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
    explicit = true;
  }
  digits = digits.replace(/\D/g, '');
  if (!digits) return null;

  if (explicit) {
    return isValidE164Digits(digits) ? `+${digits}` : null;
  }

  const country = defaultPrefix.replace(/\D/g, '');
  // Ya viene con el código de país pegado (típico de exports de WhatsApp).
  if (country && digits.startsWith(country) && isValidE164Digits(digits)) {
    return `+${digits}`;
  }
  // Número nacional: se le quita el 0 de larga distancia y se le antepone el país.
  const local = digits.replace(/^0+/, '');
  if (!local) return null;
  const full = `${country}${local}`;
  return isValidE164Digits(full) ? `+${full}` : null;
}

function isValidE164Digits(digits: string): boolean {
  return (
    digits.length >= E164_MIN &&
    digits.length <= E164_MAX &&
    !digits.startsWith('0')
  );
}

// ─────────────────────────── emails ───────────────────────────

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

/** Email en minúsculas y validado, o `null`. */
export function normalizeEmail(raw: string): string | null {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return null;
  // Algunos CRM exportan varios correos en una celda: tomamos el primero.
  const first = text.split(/[,;]/)[0].trim();
  return EMAIL.test(first) ? first : null;
}

// ─────────────────────────── estado del embudo ───────────────────────────

/** Etapas de otros CRM que sabemos traducir a nuestro `LeadStatus`. */
const STATUS_SYNONYMS: Record<LeadStatus, string[]> = {
  [LeadStatus.NUEVO]: ['nuevo', 'new', 'lead', 'sin contactar', 'subscriber'],
  [LeadStatus.CONTACTADO]: [
    'contactado',
    'contacted',
    'primer contacto',
    'attempted to contact',
    'connected',
  ],
  [LeadStatus.EN_CONVERSACION]: [
    'en conversacion',
    'conversando',
    'en proceso',
    'abierto',
    'open',
    'in progress',
    'negociacion',
    'qualified',
    'opportunity',
  ],
  [LeadStatus.AGENDADO]: [
    'agendado',
    'agendada',
    'reunion agendada',
    'cita agendada',
    'scheduled',
    'meeting scheduled',
    'demo',
    'appointment',
  ],
  [LeadStatus.CERRADO_GANADO]: [
    'ganado',
    'cerrado ganado',
    'cliente',
    'vendido',
    'won',
    'closed won',
    'customer',
  ],
  [LeadStatus.CERRADO_PERDIDO]: [
    'perdido',
    'cerrado perdido',
    'descartado',
    'no interesado',
    'lost',
    'closed lost',
    'unqualified',
  ],
  [LeadStatus.ESCALADO_HUMANO]: [
    'escalado',
    'escalado humano',
    'derivado',
    'escalated',
  ],
};

/**
 * Traduce la etapa del otro CRM a nuestro embudo. Devuelve `null` si no la
 * reconoce: quien llama decide el fallback (hoy, NUEVO) — preferimos un estado
 * conservador antes que adivinar que un lead ya está ganado.
 */
export function mapStatus(raw: string): LeadStatus | null {
  const normalized = normalizeHeader(raw);
  if (!normalized) return null;
  for (const status of Object.keys(STATUS_SYNONYMS) as LeadStatus[]) {
    if (STATUS_SYNONYMS[status].includes(normalized)) {
      return status;
    }
  }
  return null;
}

/** Estados en los que contactar automáticamente sería un error. */
export const CLOSED_STATUSES: LeadStatus[] = [
  LeadStatus.CERRADO_GANADO,
  LeadStatus.CERRADO_PERDIDO,
];
