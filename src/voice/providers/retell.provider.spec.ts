import { RetellVoiceProvider } from './retell.provider';

describe('RetellVoiceProvider', () => {
  const provider = new RetellVoiceProvider({
    apiKey: 'key',
    fromNumber: '+56911112222',
    agentId: 'agent_1',
  });

  function mockFetch(): jest.Mock {
    const fn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ call_id: 'call_1' }),
    });
    (global as unknown as { fetch: jest.Mock }).fetch = fn;
    return fn;
  }

  it('arma el body con override_agent_id, variables y agent_override anidado', async () => {
    const fetchMock = mockFetch();
    const res = await provider.startCall({
      to: '+56999999999',
      metadata: { companyId: 'c1', leadId: 'l1' },
      dynamicVariables: { nombre: 'Ana', tono: 'Cercano' },
      overrides: {
        voiceId: '11labs-Adrian',
        voiceSpeed: 1.2,
        language: 'es-419',
        beginMessage: 'Hola {{nombre}}',
      },
    });

    expect(res).toEqual({ callId: 'call_1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from_number).toBe('+56911112222');
    expect(body.to_number).toBe('+56999999999');
    expect(body.override_agent_id).toBe('agent_1');
    expect(body.retell_llm_dynamic_variables).toEqual({
      nombre: 'Ana',
      tono: 'Cercano',
    });
    expect(body.agent_override).toEqual({
      agent: {
        voice_id: '11labs-Adrian',
        voice_speed: 1.2,
        language: 'es-419',
      },
      retell_llm: { begin_message: 'Hola {{nombre}}' },
    });
  });

  it('no incluye agent_override si no hay overrides', async () => {
    const fetchMock = mockFetch();
    await provider.startCall({
      to: '+56999999999',
      metadata: {},
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.agent_override).toBeUndefined();
  });
});
