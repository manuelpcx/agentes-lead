/** Payload del job de turno del agente encolado en BullMQ. */
export interface AgentTurnJobData {
  companyId: string;
  leadId: string;
  correlationId: string;
}
