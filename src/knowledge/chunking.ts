/** Opciones de troceado. Tamaños en caracteres. */
export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

/**
 * Trocea un texto en fragmentos con solapamiento, operando por palabras para no
 * cortar ninguna a la mitad (ni al inicio ni al final del fragmento). El
 * solapamiento preserva contexto entre fragmentos contiguos. Determinista.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const requestedOverlap = options.overlap ?? DEFAULT_OVERLAP;
  // El solapamiento nunca puede igualar/superar el tamaño (evita no avanzar).
  const overlap = Math.min(requestedOverlap, Math.floor(chunkSize / 2));

  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length === 0) {
    return [];
  }
  if (clean.length <= chunkSize) {
    return [clean];
  }

  const words = clean.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;

  while (i < words.length) {
    // Acumula palabras hasta acercarse a `chunkSize` caracteres.
    const parts: string[] = [];
    let length = 0;
    let j = i;
    while (j < words.length) {
      const extra = words[j].length + (parts.length > 0 ? 1 : 0);
      if (parts.length > 0 && length + extra > chunkSize) {
        break;
      }
      length += extra;
      parts.push(words[j]);
      j++;
    }

    chunks.push(parts.join(' '));
    if (j >= words.length) {
      break;
    }

    // Retrocede algunas palabras para lograr el solapamiento deseado.
    let back = 0;
    let overlapChars = 0;
    while (back < parts.length - 1 && overlapChars < overlap) {
      overlapChars += parts[parts.length - 1 - back].length + 1;
      back++;
    }
    i = j - back; // garantizado > i anterior (avance asegurado)
  }

  return chunks;
}
