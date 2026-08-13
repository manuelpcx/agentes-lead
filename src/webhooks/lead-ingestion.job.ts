import { IncomingLeadDto } from './dto/incoming-lead.dto';

/** Payload del job de ingesta encolado en BullMQ. */
export interface LeadIngestionJobData {
  companyId: string;
  correlationId: string;
  payload: IncomingLeadDto;
}
