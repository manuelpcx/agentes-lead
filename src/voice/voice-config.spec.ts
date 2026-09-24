import { parseVoiceConfig, voiceConfigToOverrides } from './voice-config';

describe('parseVoiceConfig', () => {
  it('devuelve vacío si no hay voz', () => {
    expect(parseVoiceConfig(null)).toEqual({});
    expect(parseVoiceConfig({})).toEqual({});
    expect(parseVoiceConfig({ voice: 'x' })).toEqual({});
  });

  it('lee y limpia los campos válidos', () => {
    const cfg = parseVoiceConfig({
      voice: {
        voiceId: ' 11labs-Adrian ',
        tone: 'Cercano',
        beginMessage: 'Hola {{nombre}}',
        language: 'es-419',
        speed: 1.2,
      },
    });
    expect(cfg).toEqual({
      voiceId: '11labs-Adrian',
      tone: 'Cercano',
      beginMessage: 'Hola {{nombre}}',
      language: 'es-419',
      speed: 1.2,
    });
  });

  it('ignora speed no numérico o no positivo', () => {
    expect(
      parseVoiceConfig({ voice: { speed: 'rapido' } }).speed,
    ).toBeUndefined();
    expect(parseVoiceConfig({ voice: { speed: 0 } }).speed).toBeUndefined();
  });
});

describe('voiceConfigToOverrides', () => {
  it('mapea la config a overrides de llamada', () => {
    expect(
      voiceConfigToOverrides({
        voiceId: 'v1',
        speed: 1.1,
        language: 'es-ES',
        beginMessage: 'Hola',
        tone: 'x',
      }),
    ).toEqual({
      voiceId: 'v1',
      voiceSpeed: 1.1,
      language: 'es-ES',
      beginMessage: 'Hola',
    });
  });
});
