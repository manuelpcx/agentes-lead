/** Nombres de colas BullMQ. Centralizados para evitar strings mágicos. */
export const QUEUE_LEAD_INGESTION = 'lead-ingestion';
/** Cola de turnos del agente (bucle de decisión, Fase 3). */
export const QUEUE_AGENT_TURN = 'agent-turn';
/** Cola de seguimiento automático de leads (Fase 4). */
export const QUEUE_LEAD_FOLLOWUP = 'lead-followup';
/** Cola de eventos salientes hacia el CRM del cliente (webhooks firmados). */
export const QUEUE_CRM_EVENTS = 'crm-events';
/** Cola de refresco de la memoria del lead (resumen en segundo plano). */
export const QUEUE_LEAD_MEMORY = 'lead-memory';

/** Opciones por defecto de los jobs: reintentos con backoff exponencial. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  // Limpia los completados para no llenar Redis; conserva los fallidos como
  // "dead-letter" inspeccionable hasta resolverlos.
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
} as const;
