import {
  factSourcesFor,
  leadFactSources,
  validateOutgoingMessage,
} from './output-validator';

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

  it('permite el número de WhatsApp de la empresa vía extra (invitación por correo)', () => {
    const facts = leadFactSources([], { phone: null, email: 'a@b.cl' }, [
      '+56912345678',
    ]);
    const r = validateOutgoingMessage(
      'Si quieres, seguimos por WhatsApp al +569 1234 5678.',
      facts,
    );
    expect(r.allowed).toBe(true);
  });

  it('permite cifras que vienen de la metadata del lead (deuda desde el ERP)', () => {
    const facts = leadFactSources([], {
      phone: null,
      email: null,
      metadata: { monto: 150000, folio: 'F-4821', vencimiento: '2026-08-15' },
    });
    const r = validateOutgoingMessage(
      'Tu deuda es de $150.000 (folio 4821), vencida el 15/08.',
      facts,
    );
    expect(r.allowed).toBe(true);
  });

  it('bloquea una cifra inventada aunque la metadata traiga otras', () => {
    const facts = leadFactSources([], {
      phone: null,
      email: null,
      metadata: { monto: 150000 },
    });
    const r = validateOutgoingMessage('Te ofrezco pagar solo 89990', facts);
    expect(r.allowed).toBe(false);
    expect(r.offending).toContain('89990');
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

describe('comparación por fuente (no por pajar)', () => {
  it('no deja pasar una cifra formada por el cruce de dos fuentes distintas', () => {
    // "1234" no está en ninguna fuente, pero los dígitos concatenados de las
    // dos ("...12" + "34...") sí la contenían con el método anterior.
    const r = validateOutgoingMessage('Son 1234 pesos', [
      'codigo = A12',
      'folio = 34B',
    ]);

    expect(r.allowed).toBe(false);
    expect(r.offending).toContain('1234');
  });

  it('sigue permitiendo un fragmento dentro de una misma cifra', () => {
    const r = validateOutgoingMessage('Te llamo al 2033 7143', [
      'telefono = +56920337143',
    ]);

    expect(r.allowed).toBe(true);
  });
});

describe('factSourcesFor', () => {
  const lead = { phone: null, email: null, metadata: {} };

  it('respalda la hora de una cita que el propio agente acaba de agendar', () => {
    const sources = factSourcesFor({
      recordedFacts: ['Cita agendada para el 24 de septiembre de 2026, 11:00'],
      lead,
    });
    const r = validateOutgoingMessage(
      'Listo, te espero el 24 de septiembre de 2026 a las 11:00.',
      sources,
    );

    expect(r.allowed).toBe(true);
  });

  it('respalda un dato que dio el propio cliente', () => {
    const sources = factSourcesFor({
      recordedFacts: [],
      lead,
      clientMessages: ['mi pedido es el 458812, llegó incompleto'],
    });
    const r = validateOutgoingMessage(
      'Reviso el pedido 458812 y te cuento.',
      sources,
    );

    expect(r.allowed).toBe(true);
  });

  it('NO respalda lo que escribió el agente, solo lo del cliente', () => {
    const sources = factSourcesFor({
      recordedFacts: [],
      lead,
      clientMessages: ['hola, quiero info'],
    });
    const r = validateOutgoingMessage('El plan sale 49990', sources);

    expect(r.allowed).toBe(false);
    expect(r.offending).toContain('49990');
  });

  it('incluye el WhatsApp de la empresa', () => {
    const sources = factSourcesFor({
      recordedFacts: [],
      lead,
      companyWhatsApp: '+56912345678',
    });

    expect(
      validateOutgoingMessage('Escríbenos al +569 1234 5678', sources).allowed,
    ).toBe(true);
  });
});
