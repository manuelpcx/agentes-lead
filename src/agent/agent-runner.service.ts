import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/** Resultado de un turno (para el planificador de seguimiento). */
export interface TurnOutcome {
  messageSent: boolean;
  escalated: boolean;
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
  ) {
    this.maxIterations = config.get('AGENT_MAX_ITERATIONS', { infer: true });
    this.timeoutMs = config.get('AGENT_TIMEOUT_MS', { infer: true });
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
  async runFollowUp(leadId: string, instruction: string): Promise<TurnOutcome> {
    return this.execute(leadId, instruction);
  }

  /**
   * Núcleo del turno: arma contexto, corre el bucle de decisión y ejecuta las
   * herramientas. Respeta el control humano y degrada si no hay LLM. Si se pasa
   * `followUpInstruction`, opera en modo seguimiento (proactivo).
   */
  private async execute(
    leadId: string,
    followUpInstruction?: string,
  ): Promise<TurnOutcome> {
    const followUp = followUpInstruction !== undefined;
    const idle: TurnOutcome = { messageSent: false, escalated: false };

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
    const messages = await this.contextBuilder.buildMessages(leadId);
    if (followUpInstruction !== undefined) {
      messages.push({ role: 'user', content: followUpInstruction });
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
      return { messageSent: false, escalated: true };
    }

    const company = await this.resolveCompanyInfo();
    const timezone = lead.timezone ?? company.timezone ?? 'America/Santiago';
    const nowText = formatLocalDateTime(new Date(), timezone);
    const system = await this.contextBuilder.buildSystem(
      agent,
      lead,
      company.whatsapp,
      nowText,
    );
    const tools = this.toolRegistry.forAgent(agent.enabledTools);
    const toolDefs: Anthropic.Tool[] = tools.map((t) => t.definition);

    const ctx: ToolContext = {
      lead,
      agentId: agent.id,
      conversationId: conversation.id,
      recordedFacts: [],
      companyWhatsApp: company.whatsapp,
      companyName: company.name,
      companyVoice: company.voice,
      timezone,
      escalated: false,
      messageSent: false,
    };

    const deadline = Date.now() + this.timeoutMs;
    let convo = messages;

    for (let i = 0; i < this.maxIterations; i++) {
      if (Date.now() > deadline) {
        this.logger.warn(`Turno del lead ${leadId} superó el timeout`);
        break;
      }

      const response = await this.anthropic.createMessage({
        system,
        messages: convo,
        tools: toolDefs,
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

    this.logger.log(
      `Turno completado (leadId=${leadId} seguimiento=${followUp} ` +
        `enviado=${ctx.messageSent} escalado=${ctx.escalated})`,
    );
    return { messageSent: ctx.messageSent, escalated: ctx.escalated };
  }

  // ─────────────────────── privados ───────────────────────

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
