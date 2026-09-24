import { AgendarCitaTool } from './agendar-cita.tool';
import { AppointmentsService } from '../../appointments/appointments.service';
import { ToolContext } from './tool.interface';

function build() {
  const appointments = {
    schedule: jest
      .fn()
      .mockImplementation(({ startAt }: { startAt: Date }) =>
        Promise.resolve({ id: 'appt-1', startAt }),
      ),
  } as unknown as AppointmentsService;
  return { tool: new AgendarCitaTool(appointments), appointments };
}

function ctx(timezone = 'America/Mexico_City'): ToolContext {
  return {
    lead: { id: 'lead-1', phone: '+5215555555555' },
    agentId: 'ag-1',
    recordedFacts: [],
    timezone,
    followUp: false,
    escalated: false,
    messageSent: false,
  } as unknown as ToolContext;
}

/** Fecha futura "YYYY-MM-DDTHH:mm" sin zona, como la escribe el modelo. */
function futureNaive(hour = 12): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00:00`;
}

describe('AgendarCitaTool', () => {
  it('interpreta la hora sin zona en la zona del cliente, no en la del servidor', async () => {
    const { tool, appointments } = build();
    // 12:00 en Ciudad de México = 18:00 UTC (UTC-6).
    await tool.execute(
      { titulo: 'Demo', inicio: futureNaive(12) },
      ctx('America/Mexico_City'),
    );

    const { startAt } = (appointments.schedule as jest.Mock).mock.calls[0][0];
    expect(startAt.getUTCHours()).toBe(18);
  });

  it('respeta la zona explícita cuando el modelo la escribe', async () => {
    const { tool, appointments } = build();
    const mañana = futureNaive(12).slice(0, 10);
    await tool.execute(
      { titulo: 'Demo', inicio: `${mañana}T12:00:00Z` },
      ctx('America/Mexico_City'),
    );

    const { startAt } = (appointments.schedule as jest.Mock).mock.calls[0][0];
    expect(startAt.toISOString()).toBe(`${mañana}T12:00:00.000Z`);
  });

  it('rechaza una cita en el pasado (el modelo se equivocó de año)', async () => {
    const { tool, appointments } = build();
    const result = await tool.execute(
      { titulo: 'Llamada trivia', inicio: '2025-09-17T12:00:00' },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('ya pasó');
    expect(appointments.schedule).not.toHaveBeenCalled();
  });

  it('acepta agendar para dentro de un rato (tolerancia hacia atrás)', async () => {
    const { tool, appointments } = build();
    const enUnaHora = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await tool.execute(
      { titulo: 'Demo', inicio: enUnaHora },
      ctx(),
    );

    expect(result.isError).toBeUndefined();
    expect(appointments.schedule).toHaveBeenCalledTimes(1);
  });

  it('le confirma al agente la hora local, no el UTC', async () => {
    const { tool } = build();
    const result = await tool.execute(
      { titulo: 'Demo', inicio: futureNaive(12) },
      ctx('America/Mexico_City'),
    );

    expect(result.content).toContain('12:00');
    expect(result.content).not.toContain('Z');
  });

  it('cierra la cita una hora después si no viene "fin"', async () => {
    const { tool, appointments } = build();
    await tool.execute({ titulo: 'Demo', inicio: futureNaive(12) }, ctx());

    const { startAt, endAt } = (appointments.schedule as jest.Mock).mock
      .calls[0][0];
    expect(endAt.getTime() - startAt.getTime()).toBe(60 * 60 * 1000);
  });
});
