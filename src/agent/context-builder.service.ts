import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Agent, Channel, Direction, Lead } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PromptService } from '../prompts/prompt.service';
import { OUTPUT_GUARDRAIL_REMINDER } from '../prompts/default-prompts';
import { ExampleLibraryService } from '../improvement/example-library.service';

/** Canales que forman la conversación real con el cliente (no `system`). */
const CONVERSATION_CHANNELS: Channel[] = [
  Channel.whatsapp,
  Channel.email,
  Channel.call,
];

const HISTORY_LIMIT = 20;

@Injectable()
export class ContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prompts: PromptService,
    private readonly examples: ExampleLibraryService,
  ) {}

  /**
   * Arma el system prompt: versión activa + resumen del lead + guardrail +
   * ejemplos aprobados similares (few-shot, Fase 6) + roster de otros agentes y
   * nota de derivación recibida (multi-agente, Fase 8).
   */
  async buildSystem(agent: Agent, lead: Lead): Promise<string> {
    const base = await this.prompts.getActiveContent(agent.id, agent.type);
    const resumen = [
      '--- Contexto del lead ---',
      `Nombre: ${lead.name ?? '(desconocido)'}`,
      `Teléfono: ${lead.phone ?? '(sin teléfono)'}`,
      `Estado actual: ${lead.status}`,
      `Origen: ${lead.source ?? '(desconocido)'}`,
    ].join('\n');
    const roster = await this.agentRoster(agent);
    const derivacion = await this.handoffNote(agent, lead);
    return (
      `${base}\n\n${resumen}${derivacion}${roster}` +
      `${OUTPUT_GUARDRAIL_REMINDER}${await this.fewShot(lead)}`
    );
  }

  /**
   * Lista los demás agentes activos de la empresa como posibles destinos de
   * `derivarAAgente`. Sin otros agentes, no agrega nada (agente único).
   */
  private async agentRoster(agent: Agent): Promise<string> {
    const otros = await this.prisma.db.agent.findMany({
      where: { isActive: true, id: { not: agent.id } },
      select: { name: true, type: true, description: true },
      orderBy: { createdAt: 'asc' },
    });
    if (otros.length === 0) {
      return '';
    }
    const lista = otros
      .map(
        (a) =>
          `- ${a.name} (${a.type})` +
          (a.description ? `: ${a.description}` : ''),
      )
      .join('\n');
    return (
      '\n\n--- Otros agentes de la empresa (puedes derivarles con ' +
      `derivarAAgente si el tema es de su área) ---\n${lista}`
    );
  }

  /**
   * Si este agente recibió el lead por una derivación, inyecta el resumen de
   * contexto que dejó el agente anterior (contexto acotado, no historial full).
   */
  private async handoffNote(agent: Agent, lead: Lead): Promise<string> {
    const ultima = await this.prisma.db.interaction.findFirst({
      where: {
        leadId: lead.id,
        channel: Channel.system,
        metadata: { path: ['kind'], equals: 'derivacion' },
      },
      orderBy: { occurredAt: 'desc' },
      select: { metadata: true },
    });
    const meta = ultima?.metadata as {
      toAgentId?: string;
      resumen?: string;
    } | null;
    if (!meta || meta.toAgentId !== agent.id || !meta.resumen) {
      return '';
    }
    return `\n\n--- Contexto recibido por derivación ---\n${meta.resumen}`;
  }

  /** Recupera ejemplos aprobados similares al último mensaje del cliente. */
  private async fewShot(lead: Lead): Promise<string> {
    const lastInbound = await this.prisma.db.interaction.findFirst({
      where: {
        leadId: lead.id,
        channel: { in: CONVERSATION_CHANNELS },
        direction: Direction.inbound,
      },
      orderBy: { occurredAt: 'desc' },
      select: { content: true },
    });
    if (!lastInbound) {
      return '';
    }
    const similar = await this.examples.findSimilar(lastInbound.content, 2);
    if (similar.length === 0) {
      return '';
    }
    const bloque = similar
      .map((e) => `Situación: ${e.situation}\nRespuesta: ${e.agentResponse}`)
      .join('\n---\n');
    return `\n\nEJEMPLOS DE BUENAS RESPUESTAS (guía, no los copies literal):\n${bloque}`;
  }

  /**
   * Construye el historial reciente como mensajes user/assistant. Entrantes del
   * cliente → user; salientes del agente → assistant. Las interacciones de
   * canal `system` no van al modelo. Garantiza que empiece por un turno `user`.
   */
  async buildMessages(leadId: string): Promise<Anthropic.MessageParam[]> {
    const interactions = await this.prisma.db.interaction.findMany({
      where: { leadId, channel: { in: CONVERSATION_CHANNELS } },
      orderBy: { occurredAt: 'asc' },
      take: HISTORY_LIMIT,
      select: { direction: true, content: true },
    });

    const messages: Anthropic.MessageParam[] = interactions.map((i) => ({
      role: i.direction === Direction.inbound ? 'user' : 'assistant',
      content: i.content,
    }));

    // El historial debe comenzar por un turno del usuario.
    while (messages.length > 0 && messages[0].role === 'assistant') {
      messages.shift();
    }
    return messages;
  }
}
