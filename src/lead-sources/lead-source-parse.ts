/**
 * Traduce la respuesta de la API de leads del cliente a cabeceras + filas, lo
 * que entiende la importación. No conocemos su formato de antemano: se adapta
 * a lo que venga (arreglo directo o envuelto, campos anidados, camelCase o
 * snake_case) y reconoce los campos con los mismos sinónimos que el CSV. Lo
 * que no reconoce no se pierde: va a la metadata del lead.
 */
import { ImportTable } from '../import/lead-import.service';
import {
  ImportField,
  normalizeHeader,
  suggestMapping,
} from '../import/lead-mapping';

/** Tope de registros por fuente y carga, el mismo de la importación. */
export const MAX_REGISTROS = 5000;

type Registro = Record<string, unknown>;

/** Envolturas habituales de una lista en una API REST, en orden de prioridad. */
const ENVOLTURAS = [
  'data',
  'leads',
  'items',
  'results',
  'records',
  'rows',
  'contacts',
  'contactos',
  'clientes',
  'deudores',
];

function esObjeto(v: unknown): v is Registro {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function esListaDeObjetos(v: unknown): v is Registro[] {
  return Array.isArray(v) && v.every(esObjeto);
}

/** Un objeto suelto que parece un lead (trae algún dato de contacto). */
function pareceLead(o: Registro): boolean {
  const campos = Object.values(mapeoAutomatico(Object.keys(o)));
  return campos.includes('phone') || campos.includes('email');
}

/**
 * La lista de registros dentro de la respuesta. `[]` si vino vacía (no hay
 * nada nuevo); `null` si no se encontró nada con forma de lista de leads.
 */
export function extraerRegistros(
  json: unknown,
  profundidad = 0,
): Registro[] | null {
  if (Array.isArray(json)) {
    return esListaDeObjetos(json) ? json : null;
  }
  if (!esObjeto(json)) {
    return null;
  }
  for (const clave of ENVOLTURAS) {
    const valor = json[clave];
    if (Array.isArray(valor)) {
      return esListaDeObjetos(valor) ? valor : null;
    }
  }
  // Primer arreglo de objetos a la vista, con cualquier nombre.
  const otro = Object.values(json).find(
    (v) => Array.isArray(v) && v.length > 0 && esListaDeObjetos(v),
  );
  if (otro) {
    return otro as Registro[];
  }
  // Un nivel más adentro: { data: { items: [...] } }.
  if (profundidad === 0) {
    for (const valor of Object.values(json)) {
      if (esObjeto(valor)) {
        const anidada = extraerRegistros(valor, 1);
        if (anidada) return anidada;
      }
    }
  }
  return pareceLead(json) ? [json] : null;
}

function aTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Aplana un registro: `{ cliente: { telefono } }` → `cliente.telefono`. */
function aplanar(o: Registro, prefijo = '', out: Record<string, string> = {}) {
  for (const [clave, valor] of Object.entries(o)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (esObjeto(valor)) {
      aplanar(valor, ruta, out);
    } else {
      out[ruta] = aTexto(valor);
    }
  }
  return out;
}

/** Registros → cabeceras (unión de claves, en orden de aparición) + filas. */
export function aTabla(registros: Registro[]): ImportTable {
  const planos = registros.slice(0, MAX_REGISTROS).map((r) => aplanar(r));
  const headers: string[] = [];
  const vistas = new Set<string>();
  for (const p of planos) {
    for (const clave of Object.keys(p)) {
      if (!vistas.has(clave)) {
        vistas.add(clave);
        headers.push(clave);
      }
    }
  }
  return {
    headers,
    rows: planos.map((p) => headers.map((h) => p[h] ?? '')),
    truncated: Math.max(0, registros.length - MAX_REGISTROS),
    firstDataRow: 1,
  };
}

/** `contacto.phoneNumber` → `phone Number`: lo que se compara con los sinónimos. */
function etiqueta(ruta: string): string {
  const hoja = ruta.split('.').pop() ?? ruta;
  return hoja.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Identificadores de persona que una API suele traer cuando no tiene un id
 * propio. Solo se usan si no vino ningún id: en la importación por archivo el
 * RUT va a la metadata, y aquí también cuando ya hay un id.
 */
const ID_ALTERNATIVOS = [
  'rut',
  'id cliente',
  'codigo cliente',
  'customer id',
  'client id',
];

/**
 * Qué campo del lead es cada cabecera, reconocido por su nombre. Solo trae
 * las reconocidas: el resto termina en la metadata del lead.
 */
export function mapeoAutomatico(
  headers: string[],
): Record<string, ImportField> {
  const etiquetas = headers.map(etiqueta);
  const sugerido = suggestMapping(etiquetas);
  const out: Record<string, ImportField> = {};
  headers.forEach((h, i) => {
    const campo = sugerido[etiquetas[i]];
    // Dos rutas con la misma hoja ("a.id", "b.id"): gana la primera.
    if (campo && !Object.values(out).includes(campo)) {
      out[h] = campo;
    }
  });
  if (!Object.values(out).includes('externalId')) {
    const alternativo = headers.find((_h, i) =>
      ID_ALTERNATIVOS.includes(normalizeHeader(etiquetas[i])),
    );
    if (alternativo && !out[alternativo]) {
      out[alternativo] = 'externalId';
    }
  }
  return out;
}

/**
 * La URL que hay que llamar. Quien configura suele pegar la dirección que ve
 * en el navegador; en Airtable esa es la página web
 * (`airtable.com/app…/tbl…/viw…`), que devuelve HTML. Se traduce a su API
 * (`api.airtable.com/v0/app…/tbl…?view=viw…`). Cualquier otra queda igual.
 */
export function urlDeApi(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'airtable.com' && host !== 'www.airtable.com') {
    return raw;
  }
  const [base, tabla, vista] = url.pathname.split('/').filter(Boolean);
  if (!/^app\w+$/.test(base ?? '') || !/^tbl\w+$/.test(tabla ?? '')) {
    return raw;
  }
  const api = `https://api.airtable.com/v0/${base}/${tabla}`;
  return /^viw\w+$/.test(vista ?? '') ? `${api}?view=${vista}` : api;
}
