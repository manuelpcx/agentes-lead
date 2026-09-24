// Copia las guías del panel desde `docs/` (la fuente) a `frontend/src/content/`.
//
// Por qué hay una copia y no un import directo: el frontend se despliega solo
// desde `frontend/` (Vercel sube esa carpeta y nada más), así que un
// `import '../../../docs/PANEL.md'` compila local pero revienta en el deploy.
// Y el backend lee `docs/` en runtime para el asistente de ayuda. Cada uno
// necesita el archivo dentro de su propio paquete.
//
// La fuente que se edita es SIEMPRE `docs/`. Después:
//     npm run sync:guides
//
// Si se te olvida, el test `src/help/guides-sync.spec.ts` falla y te lo dice.
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Origen en `docs/` → destino dentro del frontend. */
export const GUIDES = [
  ['docs/PANEL.md', 'frontend/src/content/panel-guide.es.md'],
  ['docs/PANEL.en.md', 'frontend/src/content/panel-guide.en.md'],
];

let cambiados = 0;
for (const [origen, destino] of GUIDES) {
  const from = join(root, origen);
  const to = join(root, destino);
  const nuevo = readFileSync(from, 'utf8');
  let actual = null;
  try {
    actual = readFileSync(to, 'utf8');
  } catch {
    // No existe todavía: se crea.
  }
  if (actual === nuevo) {
    continue;
  }
  copyFileSync(from, to);
  console.log(`actualizado ${destino}`);
  cambiados++;
}

console.log(
  cambiados === 0
    ? 'Las guías del panel ya estaban al día.'
    : `${cambiados} guía(s) sincronizada(s).`,
);
