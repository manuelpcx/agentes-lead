import { REFRESH_EVERY_INTERACTIONS } from './lead-memory.service';
import {
  SenalesDeRefresco,
  motivoDeRefresco,
  volvioTrasSilencio,
} from './refresh-triggers';

const BASE: SenalesDeRefresco = {
  tieneResumen: true,
  nuevas: 1,
  huboLlamada: false,
  huboEventoClave: false,
  volvioTrasSilencio: false,
};

describe('motivoDeRefresco', () => {
  it('sin mensajes nuevos no hay nada que refrescar, pase lo que pase', () => {
    expect(
      motivoDeRefresco({ ...BASE, nuevas: 0, huboLlamada: true }),
    ).toBeNull();
  });

  it('un mensaje nuevo cualquiera no alcanza', () => {
    expect(motivoDeRefresco(BASE)).toBeNull();
  });

  it(`refresca al juntar ${REFRESH_EVERY_INTERACTIONS} mensajes nuevos`, () => {
    expect(
      motivoDeRefresco({ ...BASE, nuevas: REFRESH_EVERY_INTERACTIONS }),
    ).toBe('mensajes');
  });

  it('un lead nuevo tiene su primer resumen con 3 mensajes, sin esperar 10', () => {
    expect(motivoDeRefresco({ ...BASE, tieneResumen: false, nuevas: 3 })).toBe(
      'primer_resumen',
    );
    expect(
      motivoDeRefresco({ ...BASE, tieneResumen: false, nuevas: 2 }),
    ).toBeNull();
  });

  it('refresca después de una llamada', () => {
    expect(motivoDeRefresco({ ...BASE, huboLlamada: true })).toBe('llamada');
  });

  it('refresca después de escalar, prometer un pago o derivar', () => {
    expect(motivoDeRefresco({ ...BASE, huboEventoClave: true })).toBe('evento');
  });

  it('refresca cuando el lead vuelve tras un silencio largo', () => {
    expect(motivoDeRefresco({ ...BASE, volvioTrasSilencio: true })).toBe(
      'regreso',
    );
  });
});

describe('volvioTrasSilencio', () => {
  const DIA = 24 * 3_600_000;
  const t0 = new Date('2026-10-01T12:00:00Z').getTime();
  const msg = (direction: string, dias: number) => ({
    direction,
    occurredAt: new Date(t0 + dias * DIA),
  });

  it('detecta al cliente que escribe tras más de una semana', () => {
    expect(volvioTrasSilencio([msg('outbound', 0), msg('inbound', 8)])).toBe(
      true,
    );
  });

  it('no cuenta una conversación seguida', () => {
    expect(
      volvioTrasSilencio([
        msg('outbound', 0),
        msg('inbound', 1),
        msg('outbound', 1),
      ]),
    ).toBe(false);
  });

  it('no cuenta un seguimiento nuestro tras el silencio, solo al cliente', () => {
    expect(volvioTrasSilencio([msg('inbound', 0), msg('outbound', 10)])).toBe(
      false,
    );
  });

  it('lo encuentra aunque el agente ya haya respondido después', () => {
    expect(
      volvioTrasSilencio([
        msg('outbound', 0),
        msg('inbound', 9),
        msg('outbound', 9),
      ]),
    ).toBe(true);
  });
});
