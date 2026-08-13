import { ConflictException, Injectable } from '@nestjs/common';
import { AppointmentsService } from '../../appointments/appointments.service';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_AGENDAR_CITA } from './tool-names';

const HOUR_MS = 60 * 60 * 1000;

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
          description: 'Fecha y hora de inicio en ISO 8601.',
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
    const startAt = new Date(String(input.inicio ?? ''));
    if (!titulo || Number.isNaN(startAt.getTime())) {
      return {
        content: 'Faltan "titulo" o "inicio" válido (ISO 8601).',
        isError: true,
      };
    }
    const endAt = input.fin
      ? new Date(String(input.fin))
      : new Date(startAt.getTime() + HOUR_MS);
    if (Number.isNaN(endAt.getTime())) {
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
        content: `Cita agendada para ${appt.startAt.toISOString()} (id ${appt.id}). Confírmasela al cliente.`,
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
