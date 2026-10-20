import { EmbeddingsProvider } from './providers/embeddings-provider.interface';
import {
  buildEmbeddingsProvider,
  embeddingsSettingsFromEnv,
} from './providers/build-provider';

/**
 * Calibración de los umbrales de similitud para el embedder configurado.
 *
 * `npm run embeddings:calibrar` — con las mismas variables `EMBEDDINGS_*` que
 * la app (en Railway, las de producción). Embebe consultas típicas junto a un
 * texto que SÍ responde y otro que no, y muestra dónde cae cada puntaje.
 *
 * Va por grupos porque cada tipo de texto puntúa en su propio rango: un
 * párrafo de la base de conocimiento saca bastante más que un mensaje corto
 * del cliente, aun respondiendo igual de bien. Un umbral único deja pasar
 * fragmentos ajenos o pierde mensajes relevantes; por eso hay dos.
 */

export type GrupoCalibracion = 'conocimiento' | 'mensajes';

/** La variable que fija el umbral de cada grupo. */
export const VARIABLE_DEL_GRUPO: Record<GrupoCalibracion, string> = {
  conocimiento: 'EMBEDDINGS_MIN_SIMILARITY',
  mensajes: 'EMBEDDINGS_RECALL_MIN_SIMILARITY',
};

export interface ParDeCalibracion {
  grupo: GrupoCalibracion;
  consulta: string;
  /** Un texto que responde a la consulta, con otras palabras. */
  parecido: string;
  /** Un texto del mismo negocio que no tiene que ver. */
  ajeno: string;
}

/**
 * Consultas como las del agente. Los mensajes van como se indexan
 * (`textoParaIndexar`: "Cliente: …"), para medir lo mismo que producción.
 */
export const PARES_CALIBRACION: ParDeCalibracion[] = [
  {
    grupo: 'conocimiento',
    consulta: '¿hasta qué hora atienden?',
    parecido: 'Nuestro horario es de lunes a viernes de 9:00 a 18:00.',
    ajeno: 'El plan pro incluye reportes mensuales y soporte prioritario.',
  },
  {
    grupo: 'conocimiento',
    consulta: '¿puedo pagar en cuotas?',
    parecido: 'La deuda se puede pagar en hasta 3 partes sin interés.',
    ajeno: 'Atendemos en línea y por WhatsApp, sin sucursal física.',
  },
  {
    grupo: 'conocimiento',
    consulta: '¿cómo cancelo el servicio?',
    parecido:
      'Para dar de baja la suscripción, escribe a soporte y se corta al fin del mes.',
    ajeno:
      'El contrato digital se firma por correo y el plan se activa al día siguiente.',
  },
  {
    grupo: 'conocimiento',
    consulta: '¿hacen envíos a regiones?',
    parecido:
      'Despachamos a todo Chile; fuera de Santiago el pedido llega en 3 a 5 días hábiles.',
    ajeno: 'Puedes cambiar tu contraseña desde el menú de tu cuenta.',
  },
  {
    grupo: 'conocimiento',
    consulta: '¿tiene garantía?',
    parecido:
      'Todos los equipos se cubren por 12 meses ante fallas de fábrica.',
    ajeno: 'Las reuniones de demostración duran 30 minutos y son por video.',
  },
  {
    grupo: 'conocimiento',
    consulta: '¿qué pasa si me atraso con el pago?',
    parecido:
      'Pasados 30 días del vencimiento se cobra un recargo y se suspende el servicio.',
    ajeno: 'El plan básico permite hasta 3 usuarios por cuenta.',
  },
  {
    grupo: 'mensajes',
    consulta: '¿para cuántos locales era la cotización?',
    parecido: 'Cliente: somos tres sucursales, en Maipú, Ñuñoa y Providencia.',
    ajeno: 'Cliente: prefiero que me escriban en la tarde.',
  },
  {
    grupo: 'mensajes',
    consulta: '¿quién tiene que aprobar la compra?',
    parecido: 'Cliente: la decisión final la toma mi socio Pedro.',
    ajeno: 'Cliente: ¿tienen descuento por pago anual?',
  },
  {
    grupo: 'mensajes',
    consulta: '¿cuándo dijo que pagaba?',
    parecido: 'Cliente: el viernes me depositan el sueldo y ahí te transfiero.',
    ajeno: 'Cliente: ¿me reenvías el resumen de lo que vimos?',
  },
  {
    grupo: 'mensajes',
    consulta: '¿cuánto quería gastar?',
    parecido: 'Cliente: no puedo pasarme de 50 lucas al mes.',
    ajeno: 'Cliente: ¿atienden los sábados?',
  },
  {
    grupo: 'mensajes',
    consulta: '¿por dónde prefiere que lo contacten?',
    parecido: 'Cliente: no me llamen, escríbanme solo por acá.',
    ajeno: 'Cliente: ya revisé el catálogo que me mandaron.',
  },
  {
    grupo: 'mensajes',
    consulta: '¿qué le molestó de la competencia?',
    parecido:
      'Cliente: con el otro proveedor nunca contestaban cuando algo fallaba.',
    ajeno: 'Cliente: perfecto, quedo atento al correo.',
  },
];

export interface ResultadoDeGrupo {
  parecidos: number[];
  ajenos: number[];
  /** Pares en que lo que responde puntuó más que lo ajeno. */
  ordenCorrecto: number;
  /**
   * Piso sugerido: el múltiplo de 0,05 justo bajo lo relevante más bajo. El
   * umbral es un piso, no un corte: la búsqueda ya toma primero lo más
   * parecido, así que lo ajeno sobre el piso solo entra si no hay nada mejor.
   * Un piso sobre algo relevante, en cambio, lo pierde para siempre.
   */
  sugerido: number;
  /** Si todo lo parecido del grupo queda arriba de todo lo ajeno. */
  separa: boolean;
}

export type Calibracion = Partial<Record<GrupoCalibracion, ResultadoDeGrupo>>;

function coseno(a: number[], b: number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

/** El múltiplo de 0,05 estrictamente bajo `n` (con margen de 0,01). */
const pisoBajo = (n: number) => Math.max(0, Math.floor((n - 0.01) * 20) / 20);

export async function calibrar(
  provider: EmbeddingsProvider,
  pares: ParDeCalibracion[] = PARES_CALIBRACION,
): Promise<Calibracion> {
  const consultas = await provider.embed(
    pares.map((p) => p.consulta),
    'query',
  );
  const documentos = await provider.embed(
    pares.flatMap((p) => [p.parecido, p.ajeno]),
    'document',
  );

  const out: Calibracion = {};
  for (const grupo of ['conocimiento', 'mensajes'] as const) {
    const indices = pares
      .map((p, i) => (p.grupo === grupo ? i : -1))
      .filter((i) => i >= 0);
    if (indices.length === 0) {
      continue;
    }
    const parecidos = indices.map((i) =>
      coseno(consultas[i], documentos[2 * i]),
    );
    const ajenos = indices.map((i) =>
      coseno(consultas[i], documentos[2 * i + 1]),
    );
    const minParecido = Math.min(...parecidos);
    const maxAjeno = Math.max(...ajenos);
    out[grupo] = {
      parecidos,
      ajenos,
      ordenCorrecto: parecidos.filter((p, n) => p > ajenos[n]).length,
      sugerido: Number(pisoBajo(minParecido).toFixed(2)),
      separa: minParecido > maxAjeno,
    };
  }
  return out;
}

async function main(): Promise<void> {
  const provider = buildEmbeddingsProvider(embeddingsSettingsFromEnv());
  const actual: Record<GrupoCalibracion, number> = {
    conocimiento: provider.minSimilarity,
    mensajes: provider.recallMinSimilarity,
  };
  console.log(`Embedder: ${provider.id}\n`);

  const r = await calibrar(provider);
  for (const grupo of ['conocimiento', 'mensajes'] as const) {
    const g = r[grupo];
    if (!g) {
      continue;
    }
    const pares = PARES_CALIBRACION.filter((p) => p.grupo === grupo);
    console.log(`── ${grupo} (umbral actual: ${actual[grupo]}) ──`);
    pares.forEach((p, n) => {
      const marca = g.parecidos[n] > g.ajenos[n] ? ' ' : '✗';
      console.log(
        `${marca} ${g.parecidos[n].toFixed(3)} vs ${g.ajenos[n].toFixed(3)}  "${p.consulta}"`,
      );
    });
    console.log(
      `  Responde: ${Math.min(...g.parecidos).toFixed(3)} a ${Math.max(...g.parecidos).toFixed(3)} · ` +
        `no responde: ${Math.min(...g.ajenos).toFixed(3)} a ${Math.max(...g.ajenos).toFixed(3)}`,
    );
    console.log(`  Ordena bien ${g.ordenCorrecto} de ${pares.length} pares.`);
    console.log(
      g.separa
        ? '  Todo lo que responde queda sobre todo lo ajeno.'
        : '  Hay ajenos que puntúan más que respuestas de otras consultas: ' +
            'el umbral solo puede ser un piso (la búsqueda ordena por parecido).',
    );
    console.log(
      `  Piso sugerido: ${VARIABLE_DEL_GRUPO[grupo]}=${g.sugerido}\n`,
    );
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
