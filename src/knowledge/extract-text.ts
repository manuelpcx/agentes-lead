import { BadRequestException } from '@nestjs/common';

/**
 * Formatos que se pueden decodificar como texto plano sin ninguna librería de
 * parseo. PDF/DOCX quedan fuera por ahora — necesitan una dependencia nueva
 * que no se pudo instalar en este entorno (conflicto npm/pnpm preexistente en
 * node_modules, no de red: el registro sí responde).
 */
const PLAIN_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/** Extrae el texto de un archivo subido, o lanza un error claro si no se soporta. */
export function extractText(file: {
  originalname: string;
  buffer: Buffer;
}): string {
  const ext = extensionOf(file.originalname);
  if (!PLAIN_TEXT_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(
      `Formato "${ext || 'desconocido'}" no soportado todavía. Usa .txt, .md, .csv o .json.`,
    );
  }
  const content = file.buffer.toString('utf-8').trim();
  if (!content) {
    throw new BadRequestException('El archivo está vacío.');
  }
  return content;
}
