import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AgentType, Channel, Direction } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AnthropicService } from '../llm/anthropic.service';
import { PromptService } from '../prompts/prompt.service';
import { getDefaultPrompt } from '../prompts/default-prompts';
import { ExampleLibraryService } from '../improvement/example-library.service';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { LeadMemoryJobData } from '../memory/lead-memory.processor';
import { StructuredFactsService } from '../knowledge/structured-facts.service';
import { SemanticSearchService } from '../knowledge/semantic-search.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { InteractionsService } from '../interactions/interactions.service';
import { LeadsService } from '../leads/leads.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { ContextBuilder } from '../agent/context-builder.service';
import { AgentRunner } from '../agent/agent-runner.service';
import { ToolRegistry } from '../agent/tools/tool-registry.service';
import { AgentTool } from '../agent/tools/tool.interface';
import { ConsultarDatoTool } from '../agent/tools/consultar-dato.tool';
import { BuscarConocimientoTool } from '../agent/tools/buscar-conocimiento.tool';
import { EnviarWhatsAppTool } from '../agent/tools/enviar-whatsapp.tool';
import { EnviarCorreoTool } from '../agent/tools/enviar-correo.tool';
import { EscalarAHumanoTool } from '../agent/tools/escalar-a-humano.tool';
import { AgendarCitaTool } from '../agent/tools/agendar-cita.tool';
import { ActualizarEstadoLeadTool } from '../agent/tools/actualizar-estado-lead.tool';
import { CalificarLeadTool } from '../agent/tools/calificar-lead.tool';
import { CancelarSeguimientoTool } from '../agent/tools/cancelar-seguimiento.tool';
import { GuardarEnMemoriaTool } from '../agent/tools/guardar-en-memoria.tool';
import { IniciarLlamadaTool } from '../agent/tools/iniciar-llamada.tool';
import { RegistrarPromesaPagoTool } from '../agent/tools/registrar-promesa-pago.tool';
import { CrmEventsService } from '../crm/crm-events.service';
import { VoiceService } from '../voice/voice.service';
import { formatLocalDateTime } from '../followup/business-hours';
import { LocalEmbeddingsProvider } from '../embeddings/providers/local.provider';
import {
  ConversationRecallService,
  palabrasClave,
  seleccionarRecuerdos,
  textoParaIndexar,
} from '../memory/conversation-recall.service';
import { EvalCase, EvalRun, RunOptions } from './types';

/**
 * Mundo de evaluación: monta el turno REAL del agente — el mismo
 * `AgentRunner`, el mismo `ContextBuilder`, las mismas herramientas — sobre
 * servicios de mentira en memoria.
 *
 * Lo único que no se simula es el modelo: eso es justamente lo que se quiere
 * medir. El `AnthropicService` que se le pasa puede ser el real (con API key)
 * o uno con respuestas guionadas, que es como se prueba el propio harness sin
 * gastar tokens.
 *
 * Las llamadas están, con un proveedor de voz que no llama a nadie: sin la
 * herramienta, un agente que quiere llamar escala a una persona y casos como
 * "no me llames" no pueden detectar la llamada.
 *
 * Fuera del mundo por ahora: CRM y derivación a otro agente. Necesitan
 * proveedores externos o colas, y ninguno cambia cómo redacta el agente.
 */

const COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const LEAD_ID = '00000000-0000-4000-8000-000000000002';
const AGENT_ID = '00000000-0000-4000-8000-000000000003';

/** Lo que el turno fue dejando; lo lee el evaluador al terminar. */
interface Registro {
  acciones: EvalRun['acciones'];
  mensajes: EvalRun['mensajes'];
  escalado: boolean;
}

function minutosAtras(minutos: number): Date {
  return new Date(Date.now() - minutos * 60_000);
}

/** Convierte el historial del caso en filas de interacción. */
function historialAInteracciones(caso: EvalCase) {
  return caso.historial.map((turno) => ({
    direction: turno.de === 'cliente' ? Direction.inbound : Direction.outbound,
    channel: turno.canal ?? Channel.whatsapp,
    content: turno.texto,
    occurredAt: minutosAtras(turno.haceMinutos ?? 0),
    metadata: turno.de === 'operador' ? { byUserId: 'u-1' } : {},
  }));
}

/**
 * Arma el mundo y corre un turno. Devuelve qué hizo el agente, sin lanzar: un
 * caso que revienta es un resultado del banco, no una caída del proceso.
 */
export async function runCase(
  caso: EvalCase,
  anthropic: AnthropicService,
  opciones: RunOptions = {},
): Promise<EvalRun> {
  const sin = new Set(opciones.sin ?? []);
  const registro: Registro = { acciones: [], mensajes: [], escalado: false };
  const interacciones = historialAInteracciones(caso);
  let systemCapturado = '';

  const leadRow = {
    id: LEAD_ID,
    companyId: COMPANY_ID,
    agentId: AGENT_ID,
    externalId: 'eval-1',
    name: caso.lead?.name ?? 'Ana Pérez',
    phone: caso.lead?.phone ?? '+56911111111',
    email: caso.lead?.email ?? 'ana@ejemplo.cl',
    status: caso.lead?.status ?? 'CONTACTADO',
    source: caso.lead?.source ?? 'landing',
    metadata: caso.lead?.metadata ?? {},
    qualification: caso.lead?.qualification ?? null,
    qualificationReason: null,
    nextActionAt: null,
    nextActionType: null,
    contactAttempts: 0,
    isPausedForHuman: false,
    timezone: 'America/Santiago',
  };

  const citas = (caso.citas ?? []).map((c) => ({
    title: c.titulo,
    startAt: new Date(Date.now() + c.enHoras * 3_600_000),
    location: null,
  }));

  const prisma = {
    db: {
      agent: {
        findFirst: async () => ({
          id: AGENT_ID,
          companyId: COMPANY_ID,
          name: 'Agente',
          type: caso.agentType ?? AgentType.VENTAS,
          description: null,
          enabledTools: [],
          isActive: true,
        }),
        findMany: async () => [],
      },
      conversation: {
        findFirst: async () => ({ id: 'conv-1' }),
        create: async () => ({ id: 'conv-1' }),
      },
      interaction: {
        // Respeta el `take` de la consulta, como Postgres: sin eso un caso
        // largo le mostraría al modelo todo el historial y la memoria no
        // tendría nada que demostrar.
        findMany: async (args?: { take?: number }) =>
          [...interacciones].reverse().slice(0, args?.take),
        // El último mensaje del cliente (lo buscan la recuperación y los
        // ejemplos); cualquier otra búsqueda, como una derivación, no existe.
        findFirst: async (args?: { where?: { direction?: unknown } }) => {
          if (args?.where?.direction !== Direction.inbound) {
            return null;
          }
          const ultimo = [...interacciones]
            .reverse()
            .find((i) => i.direction === Direction.inbound);
          return ultimo ? { content: ultimo.content } : null;
        },
        count: async () => interacciones.length,
      },
      appointment: { findMany: async () => citas },
      leadNote: {
        findMany: async () =>
          (caso.notas ?? []).map((body) => ({ body, createdAt: new Date() })),
      },
      agentAction: { findMany: async () => [] },
    },
    raw: {
      company: {
        findUnique: async () => ({
          name: 'Empresa Demo',
          timezone: 'America/Santiago',
          channelsConfig: { whatsapp: { phoneNumber: '+56922222222' } },
        }),
      },
    },
  } as unknown as PrismaService;

  const prompts = {
    getActiveContent: async () =>
      caso.prompt ?? getDefaultPrompt(caso.agentType ?? AgentType.VENTAS),
  } as unknown as PromptService;

  const examples = {
    findSimilar: async () => [],
  } as unknown as ExampleLibraryService;

  // Ablación: una pieza apagada es como si nunca se hubiera guardado.
  const memory = {
    get: async () => ({
      summary: sin.has('resumen') ? null : (caso.memoria?.summary ?? null),
      facts: sin.has('hechos')
        ? []
        : (caso.memoria?.facts ?? []).map((f) => ({
            importancia: 5,
            ...f,
            registradoEn: new Date().toISOString(),
          })),
      insights: sin.has('reflexiones')
        ? []
        : (caso.memoria?.conclusiones ?? []).map((texto) => ({
            texto,
            evidencia: ['eval-a', 'eval-b'],
            creadaEn: new Date().toISOString(),
          })),
      updatedAt: null,
    }),
    rememberFact: async (_id: string, clave: string, valor: string) => [
      { clave, valor, registradoEn: new Date().toISOString() },
    ],
    needsRefresh: async () => false,
  } as unknown as LeadMemoryService;

  // ── Servicios que usan las herramientas ──
  const facts = {
    getCurrent: async (clave: string) => {
      const value = caso.datos?.[clave];
      return value === undefined ? null : { key: clave, value };
    },
  } as unknown as StructuredFactsService;

  const search = {
    search: async () =>
      (caso.conocimiento ?? []).map((content, i) => ({
        content,
        documentTitle: `Documento ${i + 1}`,
        similarity: 0.9,
      })),
  } as unknown as SemanticSearchService;

  const whatsapp = {
    send: async (_to: string, texto: string) => {
      registro.mensajes.push({ canal: 'whatsapp', texto });
    },
  } as unknown as WhatsappService;

  const email = {
    send: async ({ subject, text }: { subject: string; text: string }) => {
      registro.mensajes.push({ canal: 'email', texto: `${subject}\n${text}` });
    },
  } as unknown as EmailService;

  const interactions = {
    register: async () => ({ occurredAt: new Date() }),
    // Lo que consultan las guardas de llamadas y del piso de cobranza: en el
    // mundo no hay llamadas ni gestiones previas.
    findRecent: async () => null,
    findProactiveSince: async () => [],
  } as unknown as InteractionsService;

  // Proveedor de voz que no llama a nadie: la llamada queda en `acciones`.
  const voice = {
    startCall: async () => ({ callId: 'eval-call' }),
  } as unknown as VoiceService;

  // En el mundo no hay CRM conectado: el evento se descarta.
  const crmEvents = {
    emit: async () => undefined,
  } as unknown as CrmEventsService;

  const leads = {
    getById: async () => leadRow,
    escalateToHuman: async () => {
      registro.escalado = true;
      return leadRow;
    },
    updateStatus: async () => leadRow,
    setQualification: async () => leadRow,
    cancelNextAction: async () => leadRow,
    scheduleNextAction: async () => leadRow,
  } as unknown as LeadsService;

  const agentActions = {
    record: async () => undefined,
  } as unknown as AgentActionsService;

  const appointments = {
    schedule: async ({ startAt }: { startAt: Date }) => ({
      id: 'appt-1',
      startAt,
    }),
  } as unknown as AppointmentsService;

  const herramientas: AgentTool[] = [
    new ConsultarDatoTool(facts),
    new BuscarConocimientoTool(search),
    new EnviarWhatsAppTool(whatsapp, interactions, leads),
    new EnviarCorreoTool(email, interactions, leads),
    new EscalarAHumanoTool(leads, interactions),
    new AgendarCitaTool(appointments),
    new ActualizarEstadoLeadTool(leads),
    new CalificarLeadTool(leads, interactions),
    new CancelarSeguimientoTool(leads, interactions),
    new GuardarEnMemoriaTool(memory),
    new IniciarLlamadaTool(voice, interactions, leads),
    new RegistrarPromesaPagoTool(leads, interactions, crmEvents),
  ];

  const registry = new ToolRegistry(herramientas);
  // Recuperación con lo mismo que producción: el embedder local y la misma
  // selección híbrida. Solo cambia de dónde salen los candidatos (aquí, el
  // historial del caso; allá, el SQL por vector).
  const embedder = new LocalEmbeddingsProvider(1024);
  const recall = {
    recall: async (_leadId: string, query: string, before: Date) => {
      if (sin.has('recuperacion') || palabrasClave(query).length === 0) {
        return [];
      }
      const viejas = interacciones
        .map((row, n) => ({ ...row, id: `eval-${n}` }))
        .filter((row) => row.occurredAt < before);
      if (viejas.length === 0) {
        return [];
      }
      const [q, ...docs] = await embedder.embed([
        query,
        ...viejas.map(textoParaIndexar),
      ]);
      const candidatos = viejas
        .map((row, n) => ({
          ...row,
          // Vectores normalizados: el producto punto es el coseno.
          similarity: q.reduce((s, v, k) => s + v * docs[n][k], 0),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 20);
      return seleccionarRecuerdos(candidatos, query);
    },
  } as unknown as ConversationRecallService;

  const contextBuilder = new ContextBuilder(
    prisma,
    prompts,
    examples,
    memory,
    recall,
  );

  // Envoltura del constructor de contexto para guardar el system prompt: si un
  // caso falla, lo primero que se quiere ver es qué leyó el modelo.
  const buildSystem = contextBuilder.buildSystem.bind(contextBuilder);
  contextBuilder.buildSystem = async (...args) => {
    const blocks = await buildSystem(...args);
    systemCapturado = blocks.map((b) => b.text).join('\n');
    return blocks;
  };

  const config = {
    get: (key: string) =>
      key === 'AGENT_MAX_ITERATIONS'
        ? 8
        : key === 'AGENT_TIMEOUT_MS'
          ? 120_000
          : key === 'ANTHROPIC_TOOL_CHOICE'
            ? (opciones.toolChoice ?? 'any')
            : undefined,
  } as unknown as ConfigService<EnvVars, true>;

  const memoryQueue = {
    add: async () => undefined,
  } as unknown as Queue<LeadMemoryJobData>;

  const runner = new AgentRunner(
    config,
    prisma,
    anthropic,
    contextBuilder,
    registry,
    whatsapp,
    interactions,
    leads,
    agentActions,
    memory,
    memoryQueue,
  );

  // Anota cada herramienta para registrar qué se llamó y con qué, sin tocar
  // el runner ni las herramientas reales.
  for (const tool of herramientas) {
    const original = tool.execute.bind(tool);
    tool.execute = async (input, ctx) => {
      registro.acciones.push({ tool: tool.name, input });
      return original(input, ctx);
    };
  }

  let error: string | undefined;
  try {
    await TenantContext.run(
      { companyId: COMPANY_ID, correlationId: `eval-${caso.id}` },
      () => runner.runTurn(LEAD_ID),
    );
  } catch (e) {
    error = (e as Error).message;
  }

  return {
    ...registro,
    system: systemCapturado,
    datosDelCaso: datosParaElJuez(caso, citas),
    error,
  };
}

/**
 * Los datos que tenía el agente, escritos para el juez. Las fechas van en la
 * misma zona y formato que ve el agente, para que el juez compare lo mismo.
 */
function datosParaElJuez(
  caso: EvalCase,
  citas: Array<{ title: string; startAt: Date }>,
): string {
  const partes: string[] = [];
  if (citas.length > 0) {
    partes.push(
      'Citas agendadas:\n' +
        citas
          .map(
            (c) =>
              `- ${c.title}: ${formatLocalDateTime(c.startAt, 'America/Santiago')}`,
          )
          .join('\n'),
    );
  }
  if (caso.datos && Object.keys(caso.datos).length > 0) {
    partes.push(
      `Datos de la empresa (consultarDato): ${JSON.stringify(caso.datos)}`,
    );
  }
  if (caso.conocimiento?.length) {
    partes.push(
      'Base de conocimiento (buscarConocimiento):\n' +
        caso.conocimiento.map((c) => `- ${c}`).join('\n'),
    );
  }
  if (caso.lead?.metadata && Object.keys(caso.lead.metadata).length > 0) {
    partes.push(`Datos del lead: ${JSON.stringify(caso.lead.metadata)}`);
  }
  return partes.join('\n\n');
}
