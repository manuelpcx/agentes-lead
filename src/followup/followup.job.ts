/** Payload del job de seguimiento encolado en BullMQ. */
export interface FollowUpJobData {
  companyId: string;
  leadId: string;
  correlationId: string;
}
