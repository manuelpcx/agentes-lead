import {
  FollowupDefaults,
  parseAgentFollowupConfig,
  pickTemplate,
  resolveEffectiveFollowup,
} from './followup-config';

const DEFAULTS: FollowupDefaults = {
  ladder: ['email', 'whatsapp', 'whatsapp', 'email'],
  delaysHours: [12, 48, 72],
  baseDelayHours: 24,
  maxAttempts: 4,
  template: { name: '', language: 'es' },
};

describe('parseAgentFollowupConfig', () => {
  it('devuelve vacío con basura o sin datos', () => {
    expect(parseAgentFollowupConfig(null)).toEqual({});
    expect(parseAgentFollowupConfig({})).toEqual({});
    expect(parseAgentFollowupConfig('x')).toEqual({});
    expect(parseAgentFollowupConfig([1, 2])).toEqual({});
  });

  it('lee la escalera, los delays, el tope y el retardo de primer contacto', () => {
    const cfg = parseAgentFollowupConfig({
      channelLadder: ['whatsapp', 'email'],
      delaysHours: [1, 2, '3', -1, 'x'],
      maxAttempts: 6,
      firstContactDelayMin: 2,
    });
    expect(cfg.channelLadder).toEqual(['whatsapp', 'email']);
    expect(cfg.delaysHours).toEqual([1, 2, 3]);
    expect(cfg.maxAttempts).toBe(6);
    expect(cfg.firstContactDelayMin).toBe(2);
  });

  it('lee las plantillas por propósito, ignorando entradas sin nombre', () => {
    const cfg = parseAgentFollowupConfig({
      templates: {
        opening: { name: 'apertura_v1', language: 'es_CL' },
        followup: { name: '' }, // sin nombre → ignorado
        reactivation: { name: 'reactiva_v1' }, // sin language → 'es'
      },
    });
    expect(cfg.templates).toEqual({
      opening: { name: 'apertura_v1', language: 'es_CL' },
      reactivation: { name: 'reactiva_v1', language: 'es' },
    });
  });
});

describe('resolveEffectiveFollowup', () => {
  it('sin config de agente, usa los defaults tal cual', () => {
    const eff = resolveEffectiveFollowup({}, DEFAULTS);
    expect(eff.ladder).toEqual(DEFAULTS.ladder);
    expect(eff.delaysHours).toEqual(DEFAULTS.delaysHours);
    expect(eff.maxAttempts).toBe(DEFAULTS.maxAttempts);
    expect(eff.templates).toEqual({});
  });

  it('la config del agente pisa la escalera, los delays y el tope', () => {
    const eff = resolveEffectiveFollowup(
      { channelLadder: ['whatsapp'], delaysHours: [6, 12], maxAttempts: 2 },
      DEFAULTS,
    );
    expect(eff.ladder).toEqual(['whatsapp']);
    expect(eff.delaysHours).toEqual([6, 12]);
    expect(eff.maxAttempts).toBe(2);
  });

  it('si el default global tiene plantilla y el agente no definió apertura, la usa como apertura', () => {
    const eff = resolveEffectiveFollowup(
      {},
      { ...DEFAULTS, template: { name: 'global_wa', language: 'es' } },
    );
    expect(eff.templates.opening).toEqual({
      name: 'global_wa',
      language: 'es',
    });
  });

  it('la plantilla de apertura del agente pisa la del default global', () => {
    const eff = resolveEffectiveFollowup(
      { templates: { opening: { name: 'propia', language: 'es_CL' } } },
      { ...DEFAULTS, template: { name: 'global_wa', language: 'es' } },
    );
    expect(eff.templates.opening).toEqual({
      name: 'propia',
      language: 'es_CL',
    });
  });
});

describe('pickTemplate', () => {
  it('usa la del propósito si existe', () => {
    const eff = resolveEffectiveFollowup(
      {
        templates: {
          opening: { name: 'apertura', language: 'es' },
          reactivation: { name: 'reactiva', language: 'es' },
        },
      },
      DEFAULTS,
    );
    expect(pickTemplate(eff, 'reactivation')).toEqual({
      name: 'reactiva',
      language: 'es',
    });
  });

  it('sin plantilla de ese propósito, cae a la de apertura', () => {
    const eff = resolveEffectiveFollowup(
      { templates: { opening: { name: 'apertura', language: 'es' } } },
      DEFAULTS,
    );
    expect(pickTemplate(eff, 'followup')).toEqual({
      name: 'apertura',
      language: 'es',
    });
  });

  it('sin ninguna plantilla, devuelve undefined', () => {
    const eff = resolveEffectiveFollowup({}, DEFAULTS);
    expect(pickTemplate(eff, 'opening')).toBeUndefined();
  });
});
