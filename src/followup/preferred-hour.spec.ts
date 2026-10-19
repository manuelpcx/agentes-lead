import { alinearConHoraHabitual, horaHabitual } from './preferred-hour';

const TZ = 'America/Santiago'; // UTC-3 en octubre

/** Instante para una hora local de Santiago en octubre de 2026. */
function local(dia: number, hora: number, minuto = 0): Date {
  return new Date(Date.UTC(2026, 9, dia, hora + 3, minuto));
}

describe('horaHabitual', () => {
  it('con menos de 3 respuestas no hay hábito', () => {
    expect(horaHabitual([local(1, 21), local(2, 21)], TZ)).toBeNull();
  });

  it('encuentra la hora en que suele responder', () => {
    expect(
      horaHabitual(
        [local(1, 21, 10), local(3, 21, 40), local(5, 22, 5), local(6, 20, 50)],
        TZ,
      ),
    ).toBe(21);
  });

  it('si responde a cualquier hora, no hay hábito', () => {
    expect(
      horaHabitual([local(1, 9), local(2, 13), local(3, 17), local(4, 21)], TZ),
    ).toBeNull();
  });
});

describe('alinearConHoraHabitual', () => {
  const ahora = local(10, 10);
  const siempre = () => true;

  it('corre el seguimiento a la hora habitual más cercana', () => {
    // Tocaba a las 15:00; suele responder a las 21 → 21:00 del mismo día.
    expect(
      alinearConHoraHabitual(local(10, 15), 21, TZ, ahora, siempre),
    ).toEqual(local(10, 21));
  });

  it('no lo mueve más allá del margen', () => {
    // 15:00 → 21:00 son 6 h; con margen de 4 h queda donde estaba.
    expect(
      alinearConHoraHabitual(local(10, 15), 21, TZ, ahora, siempre, 4),
    ).toEqual(local(10, 15));
  });

  it('nunca lo adelanta al pasado', () => {
    // Tocaba 11:00; las 9:00 de hoy ya pasaron y las de mañana están a 22 h.
    expect(
      alinearConHoraHabitual(local(10, 11), 9, TZ, ahora, siempre),
    ).toEqual(local(10, 11));
  });

  it('con soloHaciaAdelante no lo adelanta aunque sea lo más cercano', () => {
    // Tocaba 15:00; las 9:00 del mismo día están a 6 h, pero antes.
    expect(
      alinearConHoraHabitual(local(11, 15), 9, TZ, ahora, siempre, 24, true),
    ).toEqual(local(12, 9));
  });

  it('respeta el horario permitido: si la hora habitual no lo está, no cambia', () => {
    const hasta20 = (d: Date) => (d.getUTCHours() - 3 + 24) % 24 < 20;
    expect(
      alinearConHoraHabitual(local(10, 15), 21, TZ, ahora, hasta20),
    ).toEqual(local(10, 15));
  });
});
