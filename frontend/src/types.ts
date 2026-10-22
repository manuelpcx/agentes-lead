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
  /** Null si nunca completó ni saltó el tour de bienvenida. */
  onboardingCompletedAt: string | null;
  /** Administrador de la plataforma: ve el mantenedor de clientes. */
  isPlatformAdmin: boolean;
}

/** Una empresa cliente, como la ve el mantenedor de la plataforma. */
export interface CompanySummary {
  id: string;
  name: string;
  rut: string;
  isActive: boolean;
  createdAt: string;
  usuarios: number;
  agentesActivos: number;
  canales: string[];
  conocimiento: number;
  leads: number;
  leadsRecientes: number;
  mensajesRecientes: number;
  ultimaActividad: string | null;
  /** Voz gestionada: minutos del mes en curso y tope efectivo. */
  voz: { minutosMes: number; tope: number; topePorDefecto: boolean };
}

/** Credenciales de una demo recién creada. Se muestran una sola vez. */
export interface DemoCompanyCreated {
  companyId: string;
  companyName: string;
  email: string;
  password: string;
  webhookSecret: string;
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

export type LeadQualification = 'FRIO' | 'TIBIO' | 'CALIENTE';

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
  email: string | null;
  status: LeadStatus;
  qualification: LeadQualification | null;
  isPausedForHuman: boolean;
  nextActionAt: string | null;
  updatedAt: string;
  lastMessage: LastMessage | null;
}

export type AppointmentStatus =
  | 'PROGRAMADA'
  | 'CONFIRMADA'
  | 'CANCELADA'
  | 'COMPLETADA';

export interface Appointment {
  id: string;
  leadId: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;
}

/** Cita del calendario: incluye lo mínimo del lead para pintarla. */
export interface AppointmentWithLead extends Appointment {
  lead: { id: string; name: string | null; phone: string | null };
}

export interface LeadNote {
  id: string;
  leadId: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface Interaction {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  content: string;
  agentId: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown>;
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

export interface ComplianceIssueItem {
  id: string;
  agentName: string;
  issue: string;
  evidence: string | null;
  frequency: number;
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
    qualification: LeadQualification | null;
    qualificationReason: string | null;
    source: string | null;
    isPausedForHuman: boolean;
    contactAttempts: number;
    nextActionAt: string | null;
    nextActionType: string | null;
    campaign: string | null;
    preferredChannel: string | null;
    timezone: string | null;
  };
  interactions: Interaction[];
  agentActions: AgentAction[];
  appointments: Appointment[];
  notes: LeadNote[];
  memory: LeadMemory;
}

/** Perfil acumulado del lead: lo que el agente sabe de esa persona. */
export interface LeadMemory {
  summary: string | null;
  facts: LeadMemoryFact[];
  /** Conclusiones del agente; opcional para backends anteriores. */
  insights?: LeadMemoryInsight[];
  updatedAt: string | null;
}

export interface LeadMemoryFact {
  clave: string;
  valor: string;
  importancia?: number;
  registradoEn: string;
}

/** Conclusión deducida por el agente, con los mensajes que la respaldan. */
export interface LeadMemoryInsight {
  texto: string;
  /** Ids de las interacciones que la respaldan. */
  evidencia: string[];
  creadaEn: string;
}

// ─────────────────── importación desde otro CRM ───────────────────

/** Campos de la ficha a los que puede apuntar una columna del CSV. */
export type ImportField =
  | 'name'
  | 'phone'
  | 'email'
  | 'source'
  | 'campaign'
  | 'status'
  | 'externalId';

/** Lo que devuelve el backend tras leer el archivo, antes de importar nada. */
export interface ImportPreview {
  delimiter: string;
  headers: string[];
  totalRows: number;
  sample: string[][];
  /** Campo propuesto por cabecera; `null` = no reconocida. */
  mapping: Record<string, ImportField | null>;
  suggestedPrefix: string;
  truncated: number;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; reason: string }[];
  truncated: number;
  scheduledFirstContact: boolean;
}

// ─────────────────── llaves de API (acceso MCP) ───────────────────

export interface ApiKeySummary {
  id: string;
  name: string;
  /** Prefijo visible; no sirve para autenticarse. */
  prefix: string;
  role: 'OWNER' | 'OPERADOR' | 'SOLO_LECTURA';
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Solo al crearla: es la única vez que el backend devuelve la llave. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

/** Canal cuyo proveedor se vigila (alertas de proveedores). */
export type AlertService = 'whatsapp' | 'email' | 'voice' | 'llm';

export interface OwnAlert {
  id: string;
  service: AlertService;
  provider: string;
  providerLabel: string;
  reason: string;
  hint: string | null;
  openedAt: string;
  failureCount: number;
}

/** Sin detalle para un usuario normal; con detalle para un administrador. */
export interface PlatformAlert {
  id: string;
  service: AlertService;
  openedAt: string;
  providerLabel?: string;
  reason?: string;
  hint?: string | null;
  failureCount?: number;
}

export interface PanelAlerts {
  own: OwnAlert[];
  platform: PlatformAlert[];
}

export interface PlatformIncidentRow {
  id: string;
  scope: 'company' | 'platform';
  service: AlertService;
  provider: string;
  providerLabel: string;
  companyName: string | null;
  kind: string;
  reason: string;
  hint: string | null;
  openedAt: string;
  resolvedAt: string | null;
  failureCount: number;
  affectedCompanies: number;
}

/** Una fuente de leads por API (Integraciones → Fuente de leads). */
export interface LeadSource {
  nombre: string;
  url: string;
  /** ISO de la última carga exitosa. */
  ultimaCarga?: string;
}

/** Lo que devuelve GET /panel/lead-sources (nunca trae el token). */
export interface LeadSourcesView {
  fuentes: LeadSource[];
  parametroFecha: string | null;
  tokenConfigurado: boolean;
  /** Hay al menos una fuente: el botón "Cargar nuevos leads" se activa. */
  lista: boolean;
}

/** Resultado de una fuente al apretar "Cargar nuevos leads". */
export interface LeadSourceLoadResult {
  nombre: string;
  ok: boolean;
  recibidos: number;
  resultado?: {
    created: number;
    skipped: number;
    failed: number;
    errors: Array<{ row: number; reason: string }>;
  };
  error?: string;
}
