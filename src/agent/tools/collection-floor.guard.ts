import { AgentType } from '@prisma/client';
import { InteractionsService } from '../../interactions/interactions.service';
import {
  earliestAllowedTime,
  formatLocalDateTime,
  isLegalCollectionTime,
} from '../../followup/business-hours';
import {
  GESTION_PROACTIVA,
  TipoGestion,
  collectionWindowStart,
  evaluateCollectionFloor,
} from '../../followup/collection-floor';
import { ToolContext } from './tool.interface';

/**
 * ¿Contactar ahora es una gestión proactiva? Lo es en un turno de seguimiento,
 * salvo que ese seguimiento cumpla algo que pidió el lead (su llamada
 * agendada). Responder a un mensaje del cliente nunca lo es.
 */
export function isProactiveContact(ctx: ToolContext): boolean {
  return ctx.followUp === true && ctx.requestedByLead !== true;
}

/**
 * Marca para `Interaction.metadata` de un contacto proactivo. Se pone con
 * cualquier tipo de agente: así el conteo ya existe si un agente pasa a ser
 * de cobranza, y queda el registro de cada gestión.
 */
export function proactiveTag(ctx: ToolContext): { gestion?: string } {
  return isProactiveContact(ctx) ? { gestion: GESTION_PROACTIVA } : {};
}

export interface CollectionRefusal {
  /** Texto para el modelo: por qué no se contactó y qué hacer. */
  content: string;
  /** El contacto era proactivo: el turno debe terminar sin insistir. */
  stop: boolean;
}

/**
 * Piso legal de cobranza al momento de contactar (Ley 19.496, art. 37). El
 * planificador ya lo aplica antes de despertar al agente; esto lo repite en el
 * punto del envío para cubrir un segundo mensaje en el mismo turno o una
 * llamada que el agente decida por su cuenta. Devuelve null si puede contactar.
 */
export async function collectionFloorRefusal(
  interactions: InteractionsService,
  ctx: ToolContext,
  kind: TipoGestion,
  now: Date = new Date(),
): Promise<CollectionRefusal | null> {
  if (ctx.agentType !== AgentType.COBRANZA) {
    return null;
  }
  const proactiva = isProactiveContact(ctx);
  const tz = ctx.timezone ?? 'America/Santiago';

  // Las llamadas de cobranza van solo en horario legal, las pida quien las
  // pida. Los mensajes, solo si son proactivos: contestarle al deudor que
  // escribió a las 22:00 no es una gestión de cobranza.
  if ((kind === 'llamada' || proactiva) && !isLegalCollectionTime(now, tz)) {
    const proximo = earliestAllowedTime(now, (d) =>
      isLegalCollectionTime(d, tz),
    );
    return {
      content:
        'LÍMITE LEGAL DE COBRANZA: fuera del horario permitido (lunes a ' +
        'sábado de 8:00 a 20:00, sin festivos). No se contactó. El próximo ' +
        `horario permitido es ${formatLocalDateTime(proximo, tz)}.` +
        (proactiva
          ? ' Termina el turno.'
          : ' Si el deudor quiere que lo llames, ofrécele agendar la llamada ' +
            'para ese horario.'),
      stop: proactiva,
    };
  }
  if (!proactiva) {
    return null;
  }

  const contacts = await interactions.findProactiveSince(
    ctx.lead.id,
    collectionWindowStart(now, tz),
  );
  const veredicto = evaluateCollectionFloor({
    kind,
    now,
    timezone: tz,
    contacts,
  });
  if (veredicto.allowed) {
    return null;
  }
  return {
    content:
      `LÍMITE LEGAL DE COBRANZA: ${veredicto.reason} No se contactó. No ` +
      'insistas por otro canal: termina el turno.',
    stop: true,
  };
}
