import { LeadsService } from '../../leads/leads.service';
import { LeadMemoryService } from '../../memory/lead-memory.service';
import { TipoCompromiso } from '../../memory/commitments';
import {
  PROMISE_PAY_TYPE,
  RECONTACT_TYPE,
  SCHEDULED_CALL_TYPE,
} from '../agent.constants';

/** El tipo de próxima acción con que el seguimiento retoma cada compromiso. */
export const TIPO_DE_ACCION: Record<TipoCompromiso, string> = {
  pago: PROMISE_PAY_TYPE,
  recontacto: RECONTACT_TYPE,
};

const TIPOS_DE_COMPROMISO = new Set(Object.values(TIPO_DE_ACCION));

/**
 * Deja en el casillero de próxima acción del lead el compromiso pendiente más
 * cercano. El casillero es uno solo, así que:
 *
 * - Una llamada agendada que llega antes se respeta: la pidió la persona.
 * - Si ya no queda ningún compromiso pendiente y el casillero apuntaba a uno,
 *   pasa a seguimiento común en la misma fecha: sin esto, el seguimiento
 *   verificaría un pago que ya se confirmó.
 */
export async function programarProximoCompromiso(
  memory: LeadMemoryService,
  leads: LeadsService,
  leadId: string,
  now = new Date(),
): Promise<void> {
  // Se lee de nuevo: otra herramienta del mismo turno pudo moverlo.
  const lead = await leads.getById(leadId);
  const proximo = await memory.nextPendingCommitment(leadId, now);
  const actual = lead.nextActionAt;

  if (!proximo) {
    if (actual && TIPOS_DE_COMPROMISO.has(lead.nextActionType ?? '')) {
      await leads.scheduleNextAction(lead.id, actual, 'seguimiento');
    }
    return;
  }
  const cuando = new Date(proximo.venceEn);
  const llamadaAntes =
    lead.nextActionType === SCHEDULED_CALL_TYPE &&
    actual !== null &&
    actual > now &&
    actual < cuando;
  if (llamadaAntes) {
    return;
  }
  await leads.scheduleNextAction(lead.id, cuando, TIPO_DE_ACCION[proximo.tipo]);
}
