import { BadRequestException } from '@nestjs/common';
import { ImportField, isImportField } from './lead-mapping';
import type { DuplicateMode, ImportOptions } from './lead-import.service';

/**
 * Las opciones viajan como campos de un formulario multipart (junto al
 * archivo), así que llegan todas como texto: `mapping` es un JSON serializado
 * y los booleanos son "true"/"false". Esto las valida y las tipa, en una
 * función pura para poder probarla sin levantar HTTP.
 */
export function parseImportOptions(
  body: Record<string, unknown>,
  fileName?: string,
): ImportOptions {
  const mapping = parseMapping(body.mapping);
  const phonePrefix = String(body.phonePrefix ?? '+56').trim();
  if (!/^\+\d{1,3}$/.test(phonePrefix)) {
    throw new BadRequestException(
      'phonePrefix debe ser un código de país como "+56".',
    );
  }

  const duplicates = String(body.duplicates ?? 'update');
  if (duplicates !== 'update' && duplicates !== 'skip') {
    throw new BadRequestException('duplicates debe ser "update" o "skip".');
  }

  const source = typeof body.source === 'string' ? body.source.trim() : '';

  return {
    mapping,
    phonePrefix,
    duplicates: duplicates as DuplicateMode,
    // Por defecto NO se contacta a nadie: importar una base es traerse datos,
    // no autorizar una campaña de salida.
    scheduleFirstContact: parseBoolean(body.scheduleFirstContact),
    source: source || undefined,
    fileName,
  };
}

function parseMapping(raw: unknown): Record<string, ImportField> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException('Falta el mapeo de columnas.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('El mapeo de columnas no es un JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('El mapeo de columnas debe ser un objeto.');
  }

  const mapping: Record<string, ImportField> = {};
  const used = new Set<ImportField>();
  for (const [header, field] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    // Las columnas sin campo asignado no son un error: van a la metadata.
    if (field === null || field === undefined || field === '') continue;
    if (typeof field !== 'string' || !isImportField(field)) {
      throw new BadRequestException(
        `La columna "${header}" apunta a un campo desconocido: "${String(field)}".`,
      );
    }
    if (used.has(field)) {
      throw new BadRequestException(
        `Hay dos columnas asignadas al mismo campo ("${field}").`,
      );
    }
    used.add(field);
    mapping[header] = field;
  }
  return mapping;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}
