/** Tipos de evento que se envían al CRM del cliente (webhook saliente). */
export type CrmEventType =
  | 'lead.status_changed'
  | 'lead.promise_to_pay'
  | 'lead.appointment_scheduled'
  | 'test.ping';

/** Datos que viajan en la cola para entregar un evento (job de BullMQ). */
export interface CrmEventJob {
  companyId: string;
  leadId: string;
  externalId: string | null;
  event: CrmEventType;
  data: Record<string, unknown>;
  occurredAt: string;
}
