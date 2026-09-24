// Los decoradores de los DTO la necesitan; en la app la carga Nest al arrancar.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OnboardingDto } from './dto/onboarding.dto';
import { validateOutgoingMessage } from '../agent/output-validator';

/**
 * La base de conocimiento de cobranza que se entrega lista para cargar
 * (`scripts/conocimiento-cobranza.json`). Estos tests evitan que vuelva a
 * quedar a medias: sin valores por completar, válida para el endpoint de
 * onboarding, y con las cifras donde el agente las pueda respaldar.
 */
const RUTA = join(
  __dirname,
  '..',
  '..',
  'scripts',
  'conocimiento-cobranza.json',
);
const raw = JSON.parse(readFileSync(RUTA, 'utf8')) as Record<string, unknown>;
// Igual que el cargador: los campos con "_" son ayuda y no se envían.
const dto = Object.fromEntries(
  Object.entries(raw).filter(([k]) => !k.startsWith('_')),
);

interface Politica {
  key: string;
  description: string;
}
interface Faq {
  question: string;
  answer: string;
}

describe('base de conocimiento de cobranza', () => {
  it('no deja ningún valor por completar', () => {
    const texto = JSON.stringify(dto);

    expect(texto).not.toMatch(/REEMPLAZ/i);
    expect(texto).not.toMatch(/\bej\.?:/i);
    // Sensible a mayúsculas: "todo" en minúscula es español ("no puedo pagar
    // todo"), no una marca pendiente.
    expect(texto).not.toMatch(/\bTODO\b|\bXXX\b/);
    expect(texto).not.toMatch(/<[a-z_]+>/i);
  });

  it('es válida para el endpoint de onboarding', () => {
    const instancia = plainToInstance(OnboardingDto, dto);
    const errores = validateSync(instancia, { whitelist: true });

    expect(errores.map((e) => e.toString())).toEqual([]);
  });

  it('las claves de política no se repiten', () => {
    const claves = (dto.policies as Politica[]).map((p) => p.key);

    expect(new Set(claves).size).toBe(claves.length);
  });

  it('trae las normas legales que aplican a toda empresa de cobranza', () => {
    const claves = (dto.policies as Politica[]).map((p) => p.key);

    for (const clave of [
      'ley_gastos_cobranza',
      'ley_horario_contacto',
      'ley_frecuencia_contacto',
      'ley_prohibiciones',
      'ley_informacion_obligatoria',
      'ley_pago_directo_acreedor',
      'ley_fin_cobranza_extrajudicial',
    ]) {
      expect(claves).toContain(clave);
    }
  });

  it('los topes legales de gastos de cobranza son los del artículo 37', () => {
    const gastos = (dto.policies as Politica[]).find(
      (p) => p.key === 'ley_gastos_cobranza',
    )!.description;

    expect(gastos).toContain('9%');
    expect(gastos).toContain('6%');
    expect(gastos).toContain('3%');
    expect(gastos).toContain('10 UF');
    expect(gastos).toContain('50 UF');
    expect(gastos).toContain('20 días');
  });

  it('nunca le da un número de cuenta al agente', () => {
    // Un número de cuenta inventado podría ser el de alguien real: un deudor
    // le transferiría a un desconocido.
    expect(JSON.stringify(dto)).not.toMatch(/cuenta corriente\s*n|\b\d{7,}\b/i);
  });

  it('cada cifra de las condiciones comerciales también está en las FAQ', () => {
    // Las FAQ son la vía por la que el agente encuentra los datos con más
    // facilidad. Si una cifra de las condiciones solo estuviera en la
    // política, el agente podría no llegar a ella y quedaría sin respaldo.
    const faqs = (dto.faqs as Faq[]).map((f) => f.answer).join(' ');
    const condiciones = (dto.policies as Politica[])
      .filter((p) =>
        ['convenio_cuotas', 'descuento_pronto_pago'].includes(p.key),
      )
      .map((p) => p.description)
      .join(' ');

    const cifras = condiciones.match(/\$?\d[\d.]*%?/g) ?? [];
    expect(cifras.length).toBeGreaterThan(0);
    for (const cifra of cifras) {
      expect(`${cifra}: ${faqs.includes(cifra)}`).toBe(`${cifra}: true`);
    }
  });

  it('el guardrail deja pasar las cifras que el agente saca de las FAQ', () => {
    // Simula lo que ve el agente al buscar en el conocimiento: el texto de
    // las FAQ como resultado de herramienta, que respalda sus cifras.
    const resultadoBusqueda = (dto.faqs as Faq[])
      .map((f) => `P: ${f.question}\nR: ${f.answer}`)
      .join('\n\n');

    for (const mensaje of [
      'Puedes pagar en hasta 6 cuotas, con un pie del 20% y una cuota mínima de $10.000.',
      'El tope de gastos de cobranza es 9% hasta 10 UF.',
    ]) {
      expect(validateOutgoingMessage(mensaje, [resultadoBusqueda])).toEqual({
        allowed: true,
        offending: [],
      });
    }
  });

  it('el horario de contacto respeta el tramo legal de 8:00 a 20:00 y no incluye domingo', () => {
    const dias = (
      dto.businessHours as {
        days: Record<string, Array<{ start: string; end: string }>>;
      }
    ).days;

    expect(dias.sun).toEqual([]);
    for (const tramos of Object.values(dias)) {
      for (const { start, end } of tramos) {
        expect(start >= '08:00').toBe(true);
        expect(end <= '20:00').toBe(true);
      }
    }
  });
});
