import { leadFactSources, validateOutgoingMessage } from './output-validator';

describe('validateOutgoingMessage (guardrail)', () => {
  it('permite un mensaje sin cifras', () => {
    const r = validateOutgoingMessage('Hola, ¿en qué te ayudo?', []);
    expect(r.allowed).toBe(true);
  });

  it('permite una cifra respaldada por un resultado de herramienta', () => {
    const facts = ['precio_consulta = {"monto":25000,"moneda":"CLP"}'];
    const r = validateOutgoingMessage('La consulta cuesta 25000 CLP', facts);
    expect(r.allowed).toBe(true);
  });

  it('acepta la misma cifra aunque venga con separadores de miles', () => {
    const facts = ['precio = {"monto":25000}'];
    const r = validateOutgoingMessage('Son $25.000 pesos', facts);
    expect(r.allowed).toBe(true);
  });

  it('BLOQUEA una cifra que no está en ningún resultado', () => {
    const facts = ['precio = {"monto":25000}'];
    const r = validateOutgoingMessage('Te lo dejo en 19990', facts);
    expect(r.allowed).toBe(false);
    expect(r.offending).toContain('19990');
  });

  it('ignora cifras pequeñas (horas, cantidades)', () => {
    const r = validateOutgoingMessage('Atendemos a las 9 y tengo 2 cupos', []);
    expect(r.allowed).toBe(true);
  });

  it('permite fragmentos del teléfono del lead vía leadFactSources', () => {
    const facts = leadFactSources([], {
      phone: '+56920337143',
      email: null,
    });
    // El teléfono formateado se parte en 2033 y 7143; no debe bloquearse.
    const r = validateOutgoingMessage('Te contacto al +569 2033 7143', facts);
    expect(r.allowed).toBe(true);
  });

  it('sigue bloqueando una cifra inventada aunque el lead tenga teléfono', () => {
    const facts = leadFactSources([], {
      phone: '+56920337143',
      email: null,
    });
    const r = validateOutgoingMessage('El plan cuesta 49990', facts);
    expect(r.allowed).toBe(false);
    expect(r.offending).toContain('49990');
  });
});
