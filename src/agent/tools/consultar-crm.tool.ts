import { Injectable } from '@nestjs/common';
import { CredentialsService } from '../../integrations/credentials.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { queryCrm } from '../../crm/crm-query';
import { AgentTool, ToolContext, ToolResult } from './tool.interface';
import { TOOL_CONSULTAR_CRM } from './tool-names';

/**
 * Consulta EN VIVO el CRM del cliente durante la conversación (BYO, opcional
 * — distinto de los eventos salientes: requiere `config.queryUrl`). Bloquea
 * el turno unos segundos mientras espera la respuesta del webhook del
 * cliente (n8n u otro), así que solo úsala cuando el dato realmente no está
 * en el contexto. El resultado respalda al guardrail de salida igual que
 * `consultarDato`/`buscarConocimiento`.
 */
@Injectable()
export class ConsultarCrmTool implements AgentTool {
  readonly name = TOOL_CONSULTAR_CRM;
  readonly definition = {
    name: this.name,
    description:
      'Consulta un dato EN VIVO en el CRM del cliente (ej. saldo actual, etapa ' +
      'del negocio, historial) cuando lo necesitas y no está en tu contexto. ' +
      'Puede tardar unos segundos; úsala solo si hace falta. Si no está ' +
      'configurada, te avisa — no inventes el dato en ese caso.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pregunta: {
          type: 'string',
          description: 'Qué necesitas saber del CRM, en una frase clara.',
        },
      },
      required: ['pregunta'],
    },
  };

  constructor(private readonly credentials: CredentialsService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const pregunta = String(input.pregunta ?? '').trim();
    if (!pregunta) {
      return { content: 'Falta el parámetro "pregunta".', isError: true };
    }

    const cred = await this.credentials.get('crm');
    const url = cred?.config.queryUrl;
    if (!cred?.isActive || !cred.secret || typeof url !== 'string' || !url) {
      return {
        content:
          'La consulta en vivo al CRM no está configurada para esta empresa. ' +
          'No inventes el dato: dilo con honestidad y ofrece escalar si hace falta.',
        isError: true,
      };
    }

    const result = await queryCrm(url, cred.secret, {
      companyId: TenantContext.requireCompanyId(),
      leadId: ctx.lead.id,
      externalId: ctx.lead.externalId,
      query: pregunta,
    });

    if (!result.ok) {
      return {
        content: `No se pudo consultar el CRM (${result.message}). No inventes el dato.`,
        isError: true,
      };
    }

    const data = result.data ?? '(sin datos)';
    // Respalda al guardrail: cualquier cifra que cites debe venir de aquí (o
    // de otra herramienta), nunca de memoria.
    ctx.recordedFacts.push(`consultarCrm("${pregunta}") = ${data}`);
    return { content: data };
  }
}
