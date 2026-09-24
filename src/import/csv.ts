/**
 * Parser de CSV propio (RFC 4180 con tolerancia). No usamos una librería
 * porque instalar dependencias rompe `node_modules` en este entorno (conflicto
 * npm/pnpm preexistente) — y porque lo que exportan los CRM es CSV simple.
 *
 * Tolerancias deliberadas frente al estándar:
 * - Separador autodetectado: los CRM en español suelen exportar con `;`
 *   (Excel en locale es-* lo usa), los gringos con `,`.
 * - Comillas solo cuentan como comillas al ABRIR campo: `ab"cd` queda literal
 *   en vez de tragarse el resto del archivo.
 * - Acepta CRLF, LF y CR sueltos, y se come el BOM de Excel.
 */

/** Separadores candidatos, en orden de preferencia ante empate. */
const DELIMITERS = [',', ';', '\t', '|'] as const;

export interface ParsedCsv {
  /** Cabeceras tal como venían (sin espacios al borde). */
  headers: string[];
  /** Filas de datos, ya alineadas al largo de `headers`. */
  rows: string[][];
  delimiter: string;
  /** Filas que traía el archivo más allá del tope, descartadas. */
  truncated: number;
}

/** Quita el BOM que Excel pone al inicio de sus CSV. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Primera línea lógica (respeta saltos dentro de comillas). */
function firstLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      return text.slice(0, i);
    }
  }
  return text;
}

/** Cuenta apariciones de `delimiter` fuera de comillas. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

/** Elige el separador que más veces aparece en la cabecera. */
export function detectDelimiter(text: string): string {
  const head = firstLine(stripBom(text));
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = countOutsideQuotes(head, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Recorre el texto carácter a carácter y arma los registros. */
function toRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoted = false;

  const endField = () => {
    record.push(quoted ? field : field.trim());
    field = '';
    quoted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // `""` dentro de comillas = una comilla literal.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    // Solo abre comillas al inicio del campo; si no, es texto.
    if (ch === '"' && field === '') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === '\r') {
      // CRLF o CR suelto: en ambos casos cierra el registro.
      if (text[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    if (ch === '\n') {
      endRecord();
      continue;
    }
    field += ch;
  }

  // Última línea sin salto final.
  if (field !== '' || record.length > 0) {
    endRecord();
  }
  return records;
}

/** ¿Registro completamente vacío? (líneas en blanco del final del archivo) */
function isEmptyRecord(record: string[]): boolean {
  return record.every((cell) => cell.trim() === '');
}

/**
 * Parsea el CSV completo. `maxRows` acota las filas de DATOS que devuelve; lo
 * que sobra se cuenta en `truncated` para poder avisarlo en vez de perderlo en
 * silencio.
 */
export function parseCsv(
  input: string,
  options: { delimiter?: string; maxRows?: number } = {},
): ParsedCsv {
  const text = stripBom(input);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = toRecords(text, delimiter).filter((r) => !isEmptyRecord(r));

  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, truncated: 0 };
  }

  const headers = records[0].map((h) => h.trim());
  const body = records.slice(1);
  const maxRows = options.maxRows ?? body.length;
  const rows = body.slice(0, maxRows).map((row) => {
    // Alinea al largo de la cabecera: rellena lo que falta, corta lo que sobra.
    const aligned = row.slice(0, headers.length);
    while (aligned.length < headers.length) aligned.push('');
    return aligned;
  });

  return {
    headers,
    rows,
    delimiter,
    truncated: Math.max(0, body.length - rows.length),
  };
}

/**
 * Pasa los bytes del archivo a texto. Excel en Windows todavía exporta CSV en
 * Latin-1 (CP1252), y ahí un "José" leído como UTF-8 sale con el carácter de
 * reemplazo (U+FFFD). Si aparece, reintenta en Latin-1.
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8;
}
