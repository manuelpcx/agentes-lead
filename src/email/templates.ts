import { EmailMessage } from './providers/email-provider.interface';

/** Formatea una fecha en la zona horaria dada, legible en español. */
function fmt(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export interface AppointmentEmailData {
  to: string;
  leadName?: string | null;
  companyName: string;
  title: string;
  startAt: Date;
  location?: string | null;
  timezone: string;
}

/** Correo de confirmación de una cita. */
export function appointmentConfirmation(
  data: AppointmentEmailData,
): EmailMessage {
  const saludo = data.leadName ? `Hola ${data.leadName},` : 'Hola,';
  const cuando = fmt(data.startAt, data.timezone);
  const lugar = data.location ? `\nLugar: ${data.location}` : '';
  const text = `${saludo}

Tu cita "${data.title}" quedó agendada para:
${cuando}${lugar}

Te esperamos.
${data.companyName}`;
  return {
    to: data.to,
    subject: `Confirmación de tu cita — ${data.companyName}`,
    text,
  };
}

/** Correo recordatorio previo a la cita. */
export function appointmentReminder(data: AppointmentEmailData): EmailMessage {
  const saludo = data.leadName ? `Hola ${data.leadName},` : 'Hola,';
  const cuando = fmt(data.startAt, data.timezone);
  const lugar = data.location ? `\nLugar: ${data.location}` : '';
  const text = `${saludo}

Te recordamos tu cita "${data.title}":
${cuando}${lugar}

Si necesitas reagendar, respóndenos.
${data.companyName}`;
  return {
    to: data.to,
    subject: `Recordatorio de tu cita — ${data.companyName}`,
    text,
  };
}
