import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Las guías del panel viven en `docs/` y se copian a `frontend/src/content/`.
 *
 * La copia existe porque cada deploy solo lleva lo suyo: Vercel sube la carpeta
 * `frontend/` y nada más, y la imagen del backend lleva `docs/` pero no el
 * frontend. Importar de una carpeta a la otra compila en local y falla en el
 * deploy — ya pasó.
 *
 * Este test es lo que hace viable tener una copia: si alguien edita `docs/` y
 * no corre `npm run sync:guides`, la app mostraría una guía vieja mientras el
 * asistente responde con la nueva. Acá se corta.
 */
const REPO = join(__dirname, '..', '..');

const PARES: Array<[string, string]> = [
  ['docs/PANEL.md', 'frontend/src/content/panel-guide.es.md'],
  ['docs/PANEL.en.md', 'frontend/src/content/panel-guide.en.md'],
];

describe('guías del panel sincronizadas', () => {
  it.each(PARES)('%s está copiada en %s', (origen, destino) => {
    const fuente = readFileSync(join(REPO, origen), 'utf8');
    const copia = readFileSync(join(REPO, destino), 'utf8');

    // El mensaje importa más que la aserción: es lo que lee quien lo rompa.
    expect(
      copia === fuente
        ? 'al día'
        : `${destino} quedó desfasada de ${origen}. Corre: npm run sync:guides`,
    ).toBe('al día');
  });

  it('la copia del frontend no está vacía', () => {
    for (const [, destino] of PARES) {
      expect(readFileSync(join(REPO, destino), 'utf8').length).toBeGreaterThan(
        1000,
      );
    }
  });
});
