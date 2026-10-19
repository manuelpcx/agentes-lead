import { AgentType, Channel } from '@prisma/client';

/** Un turno del historial de un caso, tal como se escribe en el banco. */
export interface EvalTurn {
  de: 'cliente' | 'agente' | 'operador';
  texto: string;
  /** Por defecto whatsapp. `call` sirve para transcripciones. */
  canal?: Channel;
  /** Hace cuántos minutos ocurrió (0 = recién). */
  haceMinutos?: number;
}

/** Lo que se espera del agente en un caso. */
export interface EvalExpectation {
  /** Herramientas que DEBE usar en el turno. */
  usa?: string[];
  /** Herramientas que NO debe usar. */
  noUsa?: string[];
  /** Si el turno debe terminar escalando a un humano. */
  escala?: boolean;
  /**
   * Criterios en lenguaje natural sobre el mensaje que recibe el cliente. Los
   * evalúa un modelo juez, uno por uno, con su justificación.
   */
  criterios: string[];
}

/**
 * Un caso de evaluación: el mundo del lead, la conversación hasta el momento y
 * qué debería pasar. Es todo lo que hace falta para reproducir un turno real.
 */
export interface EvalCase {
  id: string;
  descripcion: string;
  agentType?: AgentType;
  /** Prompt a evaluar. Por defecto, el prompt por defecto de ese tipo. */
  prompt?: string;
  lead?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    status?: string;
    source?: string | null;
    metadata?: Record<string, unknown>;
    qualification?: 'FRIO' | 'TIBIO' | 'CALIENTE' | null;
  };
  /** Memoria acumulada del lead. */
  memoria?: {
    summary?: string;
    facts?: Array<{ clave: string; valor: string; importancia?: number }>;
    /** Conclusiones (reflexiones) ya deducidas; en el mundo, con 2 mensajes de evidencia. */
    conclusiones?: string[];
  };
  /** Datos exactos de la empresa, lo que devuelve `consultarDato`. */
  datos?: Record<string, unknown>;
  /** Fragmentos de la base de conocimiento, lo que devuelve `buscarConocimiento`. */
  conocimiento?: string[];
  /** Citas ya agendadas del lead. */
  citas?: Array<{ titulo: string; enHoras: number }>;
  /** Notas internas del equipo. */
  notas?: string[];
  historial: EvalTurn[];
  espera: EvalExpectation;
}

/**
 * Piezas de la memoria que se pueden apagar para medir cuánto aportan
 * (ablación, como en *Generative Agents*).
 */
export type PiezaMemoria =
  'resumen' | 'hechos' | 'reflexiones' | 'recuperacion';

export const PIEZAS_MEMORIA: readonly PiezaMemoria[] = [
  'resumen',
  'hechos',
  'reflexiones',
  'recuperacion',
];

/** Cómo se corre un caso. */
export interface RunOptions {
  /** Piezas de la memoria que el agente NO recibe en esta corrida. */
  sin?: PiezaMemoria[];
  /** Igual que `ANTHROPIC_TOOL_CHOICE` en producción. Por defecto `any`. */
  toolChoice?: 'any' | 'auto';
}

/** Qué hizo el agente durante el turno. */
export interface EvalRun {
  acciones: Array<{ tool: string; input: Record<string, unknown> }>;
  mensajes: Array<{ canal: 'whatsapp' | 'email'; texto: string }>;
  escalado: boolean;
  /** System prompt completo que vio el modelo (para depurar un fallo). */
  system: string;
  /**
   * Los datos que tenía el agente (citas, datos de la empresa, conocimiento,
   * metadata del lead), escritos para el juez: sin ellos no puede verificar
   * una fecha o un monto y marca como falla una respuesta correcta.
   */
  datosDelCaso?: string;
  error?: string;
}

/** Resultado de un criterio, sea determinista o del juez. */
export interface EvalCheck {
  criterio: string;
  ok: boolean;
  detalle?: string;
}

export interface EvalResult {
  caso: EvalCase;
  run: EvalRun;
  checks: EvalCheck[];
  ok: boolean;
}
