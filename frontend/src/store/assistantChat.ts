import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export type AgentProposal =
  | {
      kind: 'create';
      name: string;
      type: string;
      description?: string;
      channels?: string[];
      leadStates?: string[];
      isDefault?: boolean;
    }
  | {
      kind: 'update';
      agentId: string;
      agentName: string;
      changes: {
        name?: string;
        description?: string;
        channels?: string[];
        leadStates?: string[];
        isDefault?: boolean;
        isActive?: boolean;
      };
    }
  | {
      kind: 'delete';
      agentId: string;
      agentName: string;
      reason?: string;
    }
  | {
      kind: 'prompt';
      agentId: string;
      agentName: string;
      content: string;
      summary?: string;
    };

export type ProposalStatus =
  | 'pending'
  | 'working'
  | 'done'
  | 'dismissed'
  | 'error';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  proposal?: AgentProposal;
  proposalStatus?: ProposalStatus;
}

export interface Conversation {
  id: string;
  companyId: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

// Topes defensivos: sin ellos, mucho uso podría exceder la cuota de
// localStorage y romper el guardado en silencio (los prompts que propone el
// asistente pueden pesar varios KB cada uno).
const MAX_STORED_MESSAGES = 200;
const MAX_CONVERSATIONS_PER_COMPANY = 50;
const TITLE_MAX_CHARS = 42;

function deriveTitle(seedText: string): string {
  const trimmed = seedText.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Nueva conversación';
  return trimmed.length > TITLE_MAX_CHARS
    ? `${trimmed.slice(0, TITLE_MAX_CHARS).trimEnd()}…`
    : trimmed;
}

function newConversationId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface AssistantChatStore {
  /** Todas las conversaciones, de todas las empresas, indexadas por id. */
  conversations: Record<string, Conversation>;
  /** Conversación abierta por empresa; `null` = "conversación nueva" (aún sin crear). */
  activeIdByCompany: Record<string, string | null>;

  listConversations: (companyId: string) => Conversation[];
  startNewConversation: (companyId: string) => void;
  setActiveConversation: (companyId: string, conversationId: string) => void;
  /** Devuelve la conversación activa de la empresa, creándola si no existe. */
  getOrCreateActiveId: (companyId: string, titleSeed: string) => string;
  appendMessages: (
    conversationId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  updateMessageAt: (
    conversationId: string,
    index: number,
    patch: Partial<ChatMessage>,
  ) => void;
}

/**
 * Conversaciones del asistente, persistidas en localStorage y compartidas
 * entre el widget flotante y la página de inicio — así no se pierden al
 * navegar entre pantallas del panel ni al recargar la página, y la persona
 * puede tener varias conversaciones separadas (una por tema) igual que un
 * historial de chat normal.
 */
export const useAssistantChatStore = create<AssistantChatStore>()(
  persist(
    (set, get) => ({
      conversations: {},
      activeIdByCompany: {},

      listConversations: (companyId) =>
        Object.values(get().conversations)
          .filter((c) => c.companyId === companyId)
          .sort((a, b) => b.updatedAt - a.updatedAt),

      startNewConversation: (companyId) =>
        set((state) => ({
          activeIdByCompany: { ...state.activeIdByCompany, [companyId]: null },
        })),

      setActiveConversation: (companyId, conversationId) =>
        set((state) => ({
          activeIdByCompany: {
            ...state.activeIdByCompany,
            [companyId]: conversationId,
          },
        })),

      getOrCreateActiveId: (companyId, titleSeed) => {
        const activeId = get().activeIdByCompany[companyId];
        if (activeId && get().conversations[activeId]) return activeId;

        const id = newConversationId();
        set((state) => {
          const ofCompany = Object.values(state.conversations)
            .filter((c) => c.companyId === companyId)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          const conversations = {
            ...state.conversations,
            [id]: {
              id,
              companyId,
              title: deriveTitle(titleSeed),
              messages: [],
              updatedAt: Date.now(),
            },
          };
          if (ofCompany.length >= MAX_CONVERSATIONS_PER_COMPANY) {
            for (const stale of ofCompany.slice(MAX_CONVERSATIONS_PER_COMPANY - 1)) {
              delete conversations[stale.id];
            }
          }
          return {
            conversations,
            activeIdByCompany: { ...state.activeIdByCompany, [companyId]: id },
          };
        });
        return id;
      },

      appendMessages: (conversationId, updater) =>
        set((state) => {
          const conversation = state.conversations[conversationId];
          if (!conversation) return state;
          const messages = updater(conversation.messages).slice(-MAX_STORED_MESSAGES);
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: { ...conversation, messages, updatedAt: Date.now() },
            },
          };
        }),

      updateMessageAt: (conversationId, index, patch) =>
        set((state) => {
          const conversation = state.conversations[conversationId];
          if (!conversation) return state;
          const messages = conversation.messages.map((m, i) =>
            i === index ? { ...m, ...patch } : m,
          );
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: { ...conversation, messages },
            },
          };
        }),
    }),
    {
      name: 'agentes-lead-assistant-chat',
      version: 2,
      // v1 guardaba un solo hilo por empresa (otra forma de dato); en vez de
      // migrarlo se arranca limpio — no había nada desplegado con ese formato.
      migrate: () => ({ conversations: {}, activeIdByCompany: {} }),
    },
  ),
);

export function useActiveConversation(companyId: string | null): Conversation | null {
  return useAssistantChatStore((s) => {
    if (!companyId) return null;
    const id = s.activeIdByCompany[companyId];
    return id ? (s.conversations[id] ?? null) : null;
  });
}

const EMPTY_CONVERSATIONS: Conversation[] = [];

export function useConversationList(companyId: string | null): Conversation[] {
  // `listConversations` arma un array nuevo cada vez; sin useShallow, cada
  // render devuelve una referencia distinta y useSyncExternalStore entra en
  // loop ("getSnapshot should be cached"). useShallow cachea y compara por
  // contenido, así la referencia solo cambia cuando cambia el contenido real.
  return useAssistantChatStore(
    useShallow((s) => (companyId ? s.listConversations(companyId) : EMPTY_CONVERSATIONS)),
  );
}
