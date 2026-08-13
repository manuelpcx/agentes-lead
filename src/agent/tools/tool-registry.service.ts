import { Inject, Injectable } from '@nestjs/common';
import { AGENT_TOOLS, AgentTool } from './tool.interface';

/**
 * Resuelve qué herramientas ve un agente según su `enabledTools`. Convención:
 * un `enabledTools` vacío significa "todas" (compat con agentes creados sin
 * lista explícita).
 */
@Injectable()
export class ToolRegistry {
  constructor(@Inject(AGENT_TOOLS) private readonly tools: AgentTool[]) {}

  /** Herramientas habilitadas para un agente. */
  forAgent(enabledTools: string[]): AgentTool[] {
    if (!enabledTools || enabledTools.length === 0) {
      return this.tools;
    }
    const enabled = new Set(enabledTools);
    return this.tools.filter((tool) => enabled.has(tool.name));
  }
}
