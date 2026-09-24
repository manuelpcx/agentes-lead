import { ConflictException, Injectable } from '@nestjs/common';
import { AppointmentsService } from '../../appointments/appointments.service';
import {
  formatLocalDateTime,
  parseInZone,
} from '../../followup/business-hours';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_AGENDAR_CITA } from './tool-names';

const HOUR_MS = 60 * 60 * 1000;
/** Tolerancia hacia atrás: agendar "ahora mismo" sigue siendo válido. */
const PAST_GRACE_MS = 5 * 60 * 1000;

/** Agenda una cita con el lead, verificando conflictos de horario. */
@Injectable()
export class AgendarCitaTool implements AgentTool {
  readonly name = TOOL_AGENDAR_CITA;
  readonly definition = {
    name: this.name,
    description:
      'Agenda una cita con el lead. Verifica que el horario no choque con otra ' +
      'cita. Si hay conflicto, propón otro horario. Al agendar, se envía una ' +
      'confirmación por correo si el lead tiene email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        titulo: { type: 'string', description: 'Título/motivo de la cita.' },
        inicio: {
          type: 'string',
          description:
            'Fecha y hora de inicio en ISO 8601 (ej. "2026-03-14T15:00"). ' +
            'Se interpreta en la zona horaria del cliente. Usa SIEMPRE el año ' +
            'y el día de la fecha actual que aparece en tu contexto: debe ser ' +
            'un horario futuro.',
        },
        fin: {
          type: 'string',
          description:
            'Fecha y hora de fin en ISO 8601 (opcional; por defecto +1h).',
        },
        ubicacion: {
          type: 'string',
          description: 'Lugar de la cita (opcional).',
        },
      },
      required: ['titulo', 'inicio'],
    },
  };

  constructor(private readonly appointments: AppointmentsService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const titulo = String(input.titulo ?? '').trim();
    const tz = ctx.timezone ?? 'America/Santiago';
    // Sin zona explícita, la hora es la de la empresa/lead — no la del servidor
    // (que en producción es UTC y corría las citas varias horas).
    const startAt = parseInZone(String(input.inicio ?? ''), tz);
    if (!titulo || !startAt) {
      return {
        content: 'Faltan "titulo" o "inicio" válido (ISO 8601).',
        isError: true,
      };
    }

    // Guarda contra fechas pasadas: el modelo puede equivocarse de año o de día
    // al convertir un "mañana". Una cita en el pasado no dispara recordatorio y
    // el cliente se queda esperando.
    const now = Date.now();
    if (startAt.getTime() < now - PAST_GRACE_MS) {
      return {
        content:
          `"${String(input.inicio)}" ya pasó (ahora es ${formatLocalDateTime(new Date(), tz)}). ` +
          'Revisa la fecha y hora actual de tu contexto y agenda un horario futuro.',
        isError: true,
      };
    }

    const endAt = input.fin
      ? parseInZone(String(input.fin), tz)
      : new Date(startAt.getTime() + HOUR_MS);
    if (!endAt) {
      return { content: '"fin" no es una fecha válida.', isError: true };
    }

    try {
      const appt = await this.appointments.schedule({
        leadId: ctx.lead.id,
        title: titulo,
        startAt,
        endAt,
        location: input.ubicacion ? String(input.ubicacion) : undefined,
        agentId: ctx.agentId,
      });
      return {
        // En hora local: es la que el agente le va a confirmar al cliente.
        content:
          `Cita agendada para ${formatLocalDateTime(appt.startAt, tz)} ` +
          `(hora del cliente, id ${appt.id}). Confírmasela al cliente con esa hora.`,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        return {
          content: `No se pudo agendar: ${error.message}. Propón otro horario al cliente.`,
        };
      }
      throw error;
    }
  }
}
