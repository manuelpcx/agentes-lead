import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Tamaño máximo de un cuerpo JSON. El de Nest por defecto (100 KB) no alcanza
 * para la transcripción que ElevenLabs manda al terminar una llamada larga:
 * trae cada turno con sus métricas, y una llamada de varios minutos lo pasa.
 * Con 100 KB esa transcripción se rechazaba y el agente no se enteraba de lo
 * que se habló. Los archivos van por multipart (multer) y tienen su propio
 * límite, así que esto no los afecta.
 */
export const JSON_BODY_LIMIT = '2mb';

/**
 * Parser JSON con el límite de arriba. Hay que llamarlo antes de `listen()`:
 * Nest no agrega su parser por defecto si ya hay uno registrado, y como la app
 * se crea con `rawBody: true`, este también guarda el cuerpo crudo que usan
 * las firmas de los webhooks.
 */
export function configureBodyParsing(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
