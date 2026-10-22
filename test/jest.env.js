/* eslint-disable */
/**
 * Entorno de los tests. Se carga antes que cualquier módulo.
 *
 * El cliente de Prisma lee el `.env` de la raíz al importarse, y ese `.env`
 * puede traer claves reales (p. ej. las de producción para probar en local).
 * Sin esto, los tests del mundo de evaluación usaban Voyage de verdad: gasto
 * de la cuenta real y resultados distintos según la máquina. Prisma no pisa
 * variables que ya existen, así que fijarlas aquí gana.
 */
process.env.EMBEDDINGS_PROVIDER = 'local';
process.env.VOYAGE_API_KEY = '';
process.env.EMBEDDINGS_MIN_SIMILARITY = '';
process.env.EMBEDDINGS_RECALL_MIN_SIMILARITY = '';
