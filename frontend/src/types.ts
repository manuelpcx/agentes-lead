export type PanelRole = 'OWNER' | 'OPERADOR' | 'SOLO_LECTURA';

export interface Membership {
  companyId: string;
  companyName: string;
  role: PanelRole;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  memberships: Membership[];
}

export type LeadStatus =
  | 'NUEVO'
  | 'CONTACTADO'
  | 'EN_CONVERSACION'
  | 'AGENDADO'
  | 'CERRADO_GANADO'
  | 'CERRADO_PERDIDO'
  | 'ESCALADO_HUMANO';

export interface LastMessage {
  content: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
}

export interface LeadListItem {
  id: string;
  name: string | null;
  phone: string | null;
  status: LeadStatus;
  isPausedForHuman: boolean;
  updatedAt: string;
  lastMessage: LastMessage | null;
}

export interface Interaction {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  content: string;
  agentId: string | null;
  occurredAt: string;
}

export interface AgentAction {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  occurredAt: string;
}

export interface AgentItem {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

/** Agente con su configuración de enrutamiento (Fase 8). */
export interface AgentFull {
  id: string;
  name: string;
  type: string;
  description: string | null;
  channels: string[];
  leadStates: string[];
  enabledTools: string[];
  priority: number;
  isDefault: boolean;
  isActive: boolean;
  /** Config de seguimiento propia (escalera, delays, plantillas). Ver followup-config. */
  followupConfig?: Record<string, unknown>;
}

/** Métricas comparadas por agente (Fase 8). */
export interface AgentMetricsRow {
  agentId: string;
  name: string;
  type: string;
  isActive: boolean;
  isDefault: boolean;
  leadsACargo: number;
  citasAgendadas: number;
  escalamientos: number;
  mensajesSalientes: number;
  derivacionesEnviadas: number;
}

/** Traspaso reciente entre agentes (Fase 8). */
export interface HandoffRow {
  leadId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  toAgentName: string | null;
  motivo: string | null;
  resumen: string | null;
  occurredAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  sourceType: string;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

export interface StructuredFactItem {
  id: string;
  key: string;
  category: string;
  value: Record<string, unknown>;
  isActive: boolean;
  validFrom: string;
}

export interface SearchResultItem {
  chunkId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

export interface KnowledgeGapItem {
  id: string;
  question: string;
  suggestedAnswer: string | null;
  frequency: number;
}

export interface ExampleItem {
  id: string;
  situation: string;
  agentResponse: string;
  outcome: string;
}

export interface PromptVersionItem {
  id: string;
  version: number;
  content: string;
  changeReason: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface MetricItem {
  metricType: string;
  value: number;
  date: string;
}

export interface CompanyConfig {
  id: string;
  name: string;
  rut: string;
  timezone: string;
  businessHours: Record<string, unknown>;
  channelsConfig: Record<string, unknown>;
  isActive: boolean;
}

export interface LeadDetail {
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    status: LeadStatus;
    source: string | null;
    isPausedForHuman: boolean;
    contactAttempts: number;
    nextActionAt: string | null;
    nextActionType: string | null;
  };
  interactions: Interaction[];
  agentActions: AgentAction[];
}
