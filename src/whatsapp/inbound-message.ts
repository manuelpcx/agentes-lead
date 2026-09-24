/**
 * Normaliza un mensaje entrante de WhatsApp a texto para el agente.
 *
 * Antes solo se entendían los mensajes de tipo `text`: un audio, una foto o el
 * toque de un botón se descartaban en silencio, así que el cliente no recibía
 * respuesta y en la bandeja no quedaba ni rastro de que había escrito.
 *
 * Sirve para Meta y para YCloud: YCloud replica el esquema de Meta, con la
 * diferencia de que algunas claves anidadas van en camelCase. Donde importa se
 * aceptan las dos formas.
 */

export interface ParsedInboundMessage {
  /** Texto que ve el agente y que queda en el historial del lead. */
  text: string;
  /**
   * false para señales débiles: se registran en el historial pero no disparan
   * un turno. Hoy solo las reacciones — contestar un mensaje completo a un
   * pulgar arriba es ruido, pero perderlo del historial también es un error.
   */
  wakeAgent: boolean;
}

/** Cómo se nombra cada adjunto en el marcador que ve el agente. */
const MEDIA_LABELS: Record<string, string> = {
  image: 'una imagen',
  audio: 'un audio',
  video: 'un video',
  document: 'un documento',
  sticker: 'un sticker',
  contacts: 'un contacto',
  order: 'un pedido del catálogo',
};

/**
 * Los marcadores van entre corchetes para que el modelo (y el operador en la
 * bandeja) distingan de un vistazo lo que dijo el cliente de lo que mandó.
 */
function marker(texto: string): string {
  return `[${texto}]`;
}

function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object'
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

function pickString(obj: unknown, key: string): string | undefined {
  const value = pick(obj, key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Primera clave con valor de una lista (para tolerar snake_case y camelCase). */
function pickAny(obj: unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = pick(obj, key);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** Describe un adjunto, sumando el pie de foto y el nombre del archivo si vienen. */
function describeMedia(message: unknown, type: string): string {
  const cuerpo = pick(message, type);
  const esNotaDeVoz = type === 'audio' && pick(cuerpo, 'voice') === true;
  const etiqueta = esNotaDeVoz ? 'una nota de voz' : MEDIA_LABELS[type];
  const nombre =
    type === 'document' ? pickString(cuerpo, 'filename') : undefined;

  let texto = `El cliente envió ${etiqueta}`;
  if (nombre) {
    texto += `: ${nombre}`;
  }
  const caption = pickString(cuerpo, 'caption');
  return caption ? `${marker(texto)} con el texto: ${caption}` : marker(texto);
}

/**
 * Devuelve el texto normalizado del mensaje, o null si no corresponde
 * registrarlo (avisos de la plataforma, o payloads incompletos).
 */
export function parseInboundMessage(
  message: unknown,
): ParsedInboundMessage | null {
  // Meta y YCloud siempre mandan `type`, pero si faltara y hubiera texto, se
  // trata como texto: descartar en silencio un mensaje del cliente por un
  // campo ausente es peor que asumir lo evidente.
  const type =
    pickString(message, 'type') ??
    (pickString(pick(message, 'text'), 'body') ? 'text' : undefined);
  if (!type) {
    return null;
  }

  switch (type) {
    case 'text': {
      const body = pickString(pick(message, 'text'), 'body');
      return body ? { text: body, wakeAgent: true } : null;
    }

    // Botón de una plantilla: el texto del botón ES lo que eligió el cliente.
    case 'button': {
      const body = pickString(pick(message, 'button'), 'text');
      return body ? { text: body, wakeAgent: true } : null;
    }

    // Botones y listas interactivas: igual que arriba, el título es su respuesta.
    case 'interactive': {
      const interactive = pick(message, 'interactive');
      const reply = pickAny(
        interactive,
        'button_reply',
        'buttonReply',
        'list_reply',
        'listReply',
      );
      const title = pickString(reply, 'title');
      return title ? { text: title, wakeAgent: true } : null;
    }

    case 'reaction': {
      const emoji = pickString(pick(message, 'reaction'), 'emoji');
      const texto = emoji
        ? `El cliente reaccionó con ${emoji}`
        : 'El cliente reaccionó a un mensaje';
      return { text: marker(texto), wakeAgent: false };
    }

    case 'location': {
      const location = pick(message, 'location');
      // Nombre o dirección, nunca las coordenadas: un par de números sueltos en
      // el historial no le sirve al agente y se presta a que los repita.
      const detalle =
        pickString(location, 'name') ?? pickString(location, 'address');
      const texto = detalle
        ? `El cliente compartió su ubicación: ${detalle}`
        : 'El cliente compartió su ubicación';
      return { text: marker(texto), wakeAgent: true };
    }

    // Avisos de la plataforma (cambio de número, etc.): no los escribió nadie.
    case 'system':
      return null;

    default: {
      if (MEDIA_LABELS[type]) {
        return { text: describeMedia(message, type), wakeAgent: true };
      }
      return {
        text: marker(
          `El cliente envió un mensaje que no puedo abrir (tipo: ${type})`,
        ),
        wakeAgent: true,
      };
    }
  }
}
