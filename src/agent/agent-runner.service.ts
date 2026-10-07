import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { Channel, Conversation, Direction, Lead, Prisma } from '@prisma/client';
import type { EnvVars } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AnthropicService } from '../llm/anthropic.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InteractionsService } from '../interactions/interactions.service';
import { LeadsService } from '../leads/leads.service';
import { AgentActionsService } from '../agent-actions/agent-actions.service';
import { ContextBuilder } from './context-builder.service';
import { ToolRegistry } from './tools/tool-registry.service';
import { ToolContext, ToolResult } from './tools/tool.interface';
import { FALLBACK_ESCALATION_MESSAGE } from './agent.constants';
import { VoiceConfig, parseVoiceConfig } from '../voice/voice-config';
import { formatLocalDateTime } from '../followup/business-hours';
import { appendSystemInstruction } from './conversation-history';
import { QUEUE_LEAD_MEMORY } from '../queue/queue.constants';
import { LeadMemoryService } from '../memory/lead-memory.service';
import { LeadMemoryJobData } from '../memory/lead-memory.processor';
import { VoiceService } from '../voice/voice.service';
import { TOOL_INICIAR_LLAMADA } from './tools/tool-names';

/** Resultado de un turno (para el planificador de seguimiento). */
export interface TurnOutcome {
  messageSent: boolean;
  escalated: boolean;
  /** El lead se derivó a otro agente (el seguimiento no cuenta un intento). */
  derived: boolean;
}

/** Opciones de un turno de seguimiento. */
export interface FollowUpOptions {
  /**
   * El seguimiento cumple algo que pidió el propio lead (su llamada agendada):
   * no es una gestión proactiva para los topes legales de cobranza.
   */
  requestedByLead?: boolean;
}

@Injectable()
export class AgentRunner {
  private readonly logger = new Logger(AgentRunner.name);
  private readonly maxIterations: number;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly contextBuilder: ContextBuilder,
    private readonly toolRegistry: ToolRegistry,
    private readonly whatsapp: WhatsappService,
    private readonly interactions: InteractionsService,
    private readonly leads: LeadsService,
    private readonly agentActions: AgentActionsService,
    private readonly memory: LeadMemoryService,
    @InjectQueue(QUEUE_LEAD_MEMORY)
    private readonly memoryQueue: Queue<LeadMemoryJobData>,
    @Optional() private readonly voice?: VoiceService,
  ) {
    this.maxIterations = config.get('AGENT_MAX_ITERATIONS', { infer: true });
    this.timeoutMs = config.get('AGENT_TIMEOUT_MS', { infer: true });
  }

  /**
   * Herramientas del agente para este turno. Si la empresa no puede llamar
   * (sin voz configurada, o sin minutos o cupo en la voz gestionada), se le
   * quita `iniciarLlamada`: si no, le ofrece al cliente una llamada que no
   * va a salir.
   */
  private async availableTools(enabledTools: string[]) {
    const tools = this.toolRegistry.forAgent(enabledTools);
    if (!this.voice || !tools.some((t) => t.name === TOOL_INICIAR_LLAMADA)) {
      return tools;
    }
    const voz = await this.voice.availability().catch(() => null);
    return voz && !voz.canCall
      ? tools.filter((t) => t.name !== TOOL_INICIAR_LLAMADA)
      : tools;
  }

  /** Turno de respuesta a un mensaje entrante del cliente. */
  async runTurn(leadId: string): Promise<void> {
    await this.execute(leadId);
  }

  /**
   * Turno de seguimiento proactivo (Fase 4): el agente decide y envía un
   * mensaje de re-contacto. Devuelve qué ocurrió para que el planificador
   * reprograme o cierre.
   */
  async runFollowUp(
    leadId: string,
    instruction: string,
    options: FollowUpOptions = {},
  ): Promise<TurnOutcome> {
    return this.execute(leadId, instruction, options);
  }

  /**
   * Núcleo del turno: arma contexto, corre el bucle de decisión y ejecuta las
   * herramientas. Respeta el control humano y degrada si no hay LLM. Si se pasa
   * `followUpInstruction`, opera en modo seguimiento (proactivo).
   */
  private async execute(
    leadId: string,
    followUpInstruction?: string,
    options: FollowUpOptions = {},
  ): Promise<TurnOutcome> {
    const followUp = followUpInstruction !== undefined;
    const idle: TurnOutcome = {
      messageSent: false,
      escalated: false,
      derived: false,
    };

    const lead = await this.leads.getById(leadId);
    if (lead.isPausedForHuman) {
      this.logger.log(`Lead ${leadId} en control humano: el agente no actúa`);
      return idle;
    }

    const agent = await this.prisma.db.agent.findFirst({
      where: { id: lead.agentId },
    });
    if (!agent) {
      this.logger.warn(`Lead ${leadId} sin agente asignado`);
      return idle;
    }

    const conversation = await this.getOpenConversation(lead, agent.id);
    // La zona horaria se resuelve antes del historial: las anotaciones de cada
    // mensaje ("hace 2 días", fechas) van en la hora del cliente, no del servidor.
    const company = await this.resolveCompanyInfo();
    const timezone = lead.timezone ?? company.timezone ?? 'America/Santiago';
    const messages = await this.contextBuilder.buildMessages(leadId, timezone);
    if (followUpInstruction !== undefined) {
      appendSystemInstruction(messages, followUpInstruction);
    }
    if (messages.length === 0) {
      return idle; // modo respuesta: no hay mensaje del cliente al que responder
    }

    // Degradación honesta: sin LLM, en respuesta escalamos; en seguimiento se omite.
    if (!this.anthropic.isConfigured()) {
      if (followUp) {
        return idle;
      }
      await this.degradeToHuman(lead);
      return { messageSent: false, escalated: true, derived: false };
    }

    const nowText = formatLocalDateTime(new Date(), timezone);
    const system = await this.contextBuilder.buildSystem(
      agent,
      lead,
      company.whatsapp,
      nowText,
      timezone,
    );
    const tools = await this.availableTools(agent.enabledTools);
    const toolDefs: Anthropic.Tool[] = tools.map((t) => t.definition);

    const ctx: ToolContext = {
      lead,
      agentId: agent.id,
      conversationId: conversation.id,
      recordedFacts: [],
      // Lo que dijo el cliente respalda al guardrail: si él dio su RUT o el
      // número de su pedido, el agente puede repetírselo sin que se bloquee.
      // Solo sus mensajes (rol `user`), nunca los del agente.
      clientMessages: messages
        .filter((m) => m.role === 'user' && typeof m.content === 'string')
        .map((m) => m.content as string),
      companyWhatsApp: company.whatsapp,
      companyName: company.name,
      companyVoice: company.voice,
      timezone,
      followUp,
      requestedByLead: followUp && options.requestedByLead === true,
      agentType: agent.type,
      escalated: false,
      derived: false,
      messageSent: false,
    };

    const deadline = Date.now() + this.timeoutMs;
    let convo = messages;

    for (let i = 0; i < this.maxIterations; i++) {
      if (Date.now() > deadline) {
        this.logger.warn(`Turno del lead ${leadId} superó el timeout`);
        break;
      }

      // Mientras el turno no esté resuelto (nada enviado/escalado/derivado
      // todavía), se fuerza el uso de ALGUNA tool: el texto suelto nunca le
      // llega al cliente, así que dejar que el modelo termine en texto en
      // este punto es sinónimo de dejarlo sin respuesta (el bug real detrás
      // de varios silencios que vimos — el modelo pedía un dato con una tool
      // y después no lo relayaba con enviarWhatsApp). Una vez resuelto, se
      // vuelve a 'auto' para permitir que el turno cierre de forma natural.
      const resolved =
        ctx.messageSent || ctx.escalated || (ctx.derived ?? false);
      const response = await this.anthropic.createMessage({
        system,
        messages: convo,
        tools: toolDefs,
        toolChoice: resolved ? undefined : { type: 'any' },
      });

      if (response.stop_reason !== 'tool_use') {
        break; // fin del turno (el texto suelto es interno; al cliente se le
        // habla por la herramienta enviarWhatsApp)
      }

      convo = [...convo, { role: 'assistant', content: response.content }];
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let stop = false;

      for (const block of response.content) {
        if (block.type !== 'tool_use') {
          continue;
        }
        const result = await this.executeTool(tools, block, ctx);
        // El resultado de CUALQUIER herramienta respalda al guardrail: es un
        // dato de nuestros sistemas, no una cifra que el modelo sacó de la
        // manga. Antes solo respaldaban tres herramientas de consulta, así que
        // el agente se bloqueaba a sí mismo al confirmar la hora de una cita
        // que él acababa de agendar.
        ctx.recordedFacts.push(result.content);
        await this.agentActions.record({
          agentId: ctx.agentId,
          leadId: ctx.lead.id,
          conversationId: ctx.conversationId,
          tool: block.name,
          input: block.input as Prisma.InputJsonValue,
          output: result.content,
          isError: result.isError,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
        if (result.stop) {
          stop = true;
        }
      }

      convo = [...convo, { role: 'user', content: toolResults }];
      if (stop) {
        break;
      }
    }

    // Red de seguridad: si el modelo respondió a un mensaje del cliente sin
    // usar ninguna herramienta (texto suelto, que es interno y no le llega a
    // nadie), sin esto el cliente se queda sin respuesta y sin ningún rastro
    // en el historial — el peor resultado posible, peor que un error visible.
    if (!followUp && !ctx.messageSent && !ctx.escalated && !ctx.derived) {
      await this.fallbackToHuman(lead, agent.id);
      ctx.escalated = true;
      ctx.messageSent = true;
    }

    await this.scheduleMemoryRefresh(leadId);

    this.logger.log(
      `Turno completado (leadId=${leadId} seguimiento=${followUp} ` +
        `enviado=${ctx.messageSent} escalado=${ctx.escalated})`,
    );
    return {
      messageSent: ctx.messageSent,
      escalated: ctx.escalated,
      derived: ctx.derived ?? false,
    };
  }

  // ─────────────────────── privados ───────────────────────

  /**
   * Encola el refresco del resumen del lead cuando ya se acumularon bastantes
   * mensajes nuevos. Va a una cola aparte y no dentro del turno: es otra
   * llamada al modelo, y el cliente no tiene por qué esperarla. El `jobId`
   * determinista evita encolar dos refrescos del mismo lead a la vez.
   *
   * Nunca hace fallar el turno: la memoria es una mejora, la respuesta no.
   */
  private async scheduleMemoryRefresh(leadId: string): Promise<void> {
    try {
      if (!(await this.memory.needsRefresh(leadId))) {
        return;
      }
      await this.memoryQueue.add(
        'refresh',
        {
          companyId: TenantContext.requireCompanyId(),
          leadId,
          correlationId: TenantContext.get()?.correlationId,
        },
        { jobId: `memory-${leadId}`, removeOnComplete: true },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo programar el refresco de memoria (leadId=${leadId}): ` +
          `${(error as Error).message}`,
      );
    }
  }

  private async executeTool(
    tools: ReturnType<ToolRegistry['forAgent']>,
    block: Anthropic.ToolUseBlock,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === block.name);
    if (!tool) {
      return {
        content: `Herramienta desconocida: ${block.name}`,
        isError: true,
      };
    }
    try {
      return await tool.execute(block.input as Record<string, unknown>, ctx);
    } catch (error) {
      this.logger.error(
        `Error ejecutando ${block.name}: ${(error as Error).message}`,
      );
      return {
        content: `Error ejecutando ${block.name}: ${(error as Error).message}`,
        isError: true,
      };
    }
  }

  /**
   * Escala a humano y avisa al cliente cuando el modelo terminó el turno sin
   * usar ninguna herramienta (respuesta en texto suelto, que nunca le llega
   * al cliente). Evita el silencio total: mismo mensaje de respaldo que la
   * degradación sin LLM, pero registrado con motivo distinto.
   */
  private async fallbackToHuman(lead: Lead, agentId: string): Promise<void> {
    await this.leads.escalateToHuman(lead.id);
    await this.interactions.register({
      leadId: lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content:
        'El agente terminó el turno sin responder al cliente (respuesta ' +
        'sin herramienta). Escalado automático a humano.',
      agentId,
    });
    if (lead.phone) {
      await this.whatsapp.send(lead.phone, FALLBACK_ESCALATION_MESSAGE);
      await this.interactions.register({
        leadId: lead.id,
        channel: Channel.whatsapp,
        direction: Direction.outbound,
        content: FALLBACK_ESCALATION_MESSAGE,
        agentId,
      });
    }
    this.logger.warn(`Lead ${lead.id} escalado: turno terminó sin respuesta`);
  }

  /** Escala a humano y avisa al cliente cuando el agente no puede operar. */
  private async degradeToHuman(lead: Lead): Promise<void> {
    await this.leads.escalateToHuman(lead.id);
    await this.interactions.register({
      leadId: lead.id,
      channel: Channel.system,
      direction: Direction.outbound,
      content: 'Agente sin LLM configurado: escalado automático a humano.',
      agentId: null,
    });
    if (lead.phone) {
      await this.whatsapp.send(lead.phone, FALLBACK_ESCALATION_MESSAGE);
      await this.interactions.register({
        leadId: lead.id,
        channel: Channel.whatsapp,
        direction: Direction.outbound,
        content: FALLBACK_ESCALATION_MESSAGE,
        agentId: null,
      });
    }
    this.logger.warn(`Lead ${lead.id} escalado por degradación (sin LLM)`);
  }

  /**
   * Datos de la empresa (tenant) para personalizar el turno: nombre y número de
   * WhatsApp (`channelsConfig.whatsapp.phoneNumber`). El WhatsApp se usa para
   * invitar por correo a seguir por ahí y como respaldo del guardrail; el nombre
   * personaliza canales como la llamada de voz.
   */
  private async resolveCompanyInfo(): Promise<{
    name: string | null;
    whatsapp: string | null;
    voice: VoiceConfig;
    timezone: string | null;
  }> {
    const companyId = TenantContext.requireCompanyId();
    const company = await this.prisma.raw.company.findUnique({
      where: { id: companyId },
      select: { name: true, channelsConfig: true, timezone: true },
    });
    const config = company?.channelsConfig as {
      whatsapp?: { phoneNumber?: unknown };
    } | null;
    const phone = config?.whatsapp?.phoneNumber;
    return {
      name: company?.name ?? null,
      whatsapp: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
      voice: parseVoiceConfig(company?.channelsConfig),
      timezone: company?.timezone ?? null,
    };
  }

  /** Busca la conversación abierta del lead (canal WhatsApp) o la crea. */
  private async getOpenConversation(
    lead: Lead,
    agentId: string,
  ): Promise<Conversation> {
    const open = await this.prisma.db.conversation.findFirst({
      where: { leadId: lead.id, channel: Channel.whatsapp, endedAt: null },
    });
    if (open) {
      return open;
    }
    return this.prisma.db.conversation.create({
      data: {
        companyId: TenantContext.requireCompanyId(),
        agentId,
        leadId: lead.id,
        channel: Channel.whatsapp,
      },
    });
  }
}
