import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import {
  useAssistantChatStore,
  useActiveConversation,
  useConversationList,
  type AgentProposal,
  type ChatMessage,
  type Conversation,
  type ProposalStatus,
} from '../store/assistantChat';

export type { AgentProposal, ChatMessage, Conversation, ProposalStatus };

// Empresa "placeholder" para cuando aún no hay compañía seleccionada (no
// debería ocurrir en las pantallas donde se usa este hook, pero evita pisar
// el historial de una empresa real).
const NO_COMPANY_KEY = 'sin-empresa';

/** Qué pasó con una propuesta, contado en el texto que ve el modelo. */
const OUTCOME_NOTE: Record<ProposalStatus, string> = {
  pending: '[Propuesta enviada; la persona aún no la confirma.]',
  working: '',
  done: '[La persona CONFIRMÓ esta propuesta con el botón y la acción ya se ejecutó. No la vuelvas a proponer.]',
  dismissed: '[La persona DESCARTÓ esta propuesta. No la repitas salvo que te lo pida de nuevo.]',
  error: '[La confirmación falló por un error: la acción NO se ejecutó.]',
};

/**
 * El backend solo recibe `role` + `text`, pero la confirmación de una
 * propuesta ocurre fuera del chat (un botón). Sin contárselo, el modelo cree
 * que nunca la envió y vuelve a proponer lo mismo — creando duplicados.
 */
function textForModel(m: ChatMessage): string {
  if (!m.proposal) {
    return m.text;
  }
  const note = OUTCOME_NOTE[m.proposalStatus ?? 'pending'];
  return note ? `${m.text}\n\n${note}` : m.text;
}

/**
 * Estado y acciones del asistente conversacional, compartido entre el widget
 * flotante y la vista principal de chat — misma lógica, dos presentaciones.
 * El historial vive en un store persistido (`store/assistantChat.ts`), con
 * varias conversaciones por empresa (no una sola), para que la persona pueda
 * abrir una nueva sin perder las anteriores y navegar entre ellas.
 * El asistente NUNCA actúa por su cuenta: `HelpService` devuelve una
 * `proposal` y es esta pantalla la que llama al endpoint real cuando la
 * persona confirma con un botón (crear/editar/eliminar un agente).
 */
export function useAssistantChat() {
  const { t } = useTranslation();
  const companyId = useAuth((s) => s.selectedCompanyId) ?? NO_COMPANY_KEY;
  const activeConversation = useActiveConversation(companyId);
  const conversations = useConversationList(companyId);
  const getOrCreateActiveId = useAssistantChatStore((s) => s.getOrCreateActiveId);
  const appendMessages = useAssistantChatStore((s) => s.appendMessages);
  const updateMessageAt = useAssistantChatStore((s) => s.updateMessageAt);
  const startNew = useAssistantChatStore((s) => s.startNewConversation);
  const setActive = useAssistantChatStore((s) => s.setActiveConversation);

  // Mensaje de bienvenida solo se usa como estado "sin conversación activa"
  // — nunca se persiste, así que se recalcula en el idioma actual.
  const messages =
    activeConversation?.messages ??
    ([{ role: 'assistant', text: t('assistant.welcome') }] as ChatMessage[]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al cambiar de conversación (o de empresa) se limpia el borrador y el
  // error — son transitorios de la conversación anterior, no del historial.
  useEffect(() => {
    setDraft('');
    setError(null);
  }, [activeConversation?.id, companyId]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const conversationId = getOrCreateActiveId(companyId, trimmed);
    let history: ChatMessage[] = [];
    appendMessages(conversationId, (prev) => {
      history = [...prev, { role: 'user', text: trimmed }];
      return history;
    });
    setDraft('');
    setError(null);
    setSending(true);
    try {
      const { data } = await api.post('/panel/help/ask', {
        messages: history.map((m) => ({
          role: m.role,
          text: textForModel(m),
        })),
      });
      appendMessages(conversationId, (prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.reply,
          proposal: data.proposal,
          proposalStatus: data.proposal ? 'pending' : undefined,
        },
      ]);
    } catch {
      setError(t('assistant.sendError'));
    } finally {
      setSending(false);
    }
  };

  const confirmProposal = async (index: number) => {
    const conversationId = activeConversation?.id;
    const proposal = messages[index]?.proposal;
    if (!conversationId || !proposal) return;
    updateMessageAt(conversationId, index, { proposalStatus: 'working' });
    try {
      if (proposal.kind === 'create') {
        await api.post('/panel/agents', {
          name: proposal.name,
          type: proposal.type,
          description: proposal.description,
          channels: proposal.channels,
          leadStates: proposal.leadStates,
          isDefault: proposal.isDefault,
        });
      } else if (proposal.kind === 'update') {
        await api.patch(`/panel/agents/${proposal.agentId}`, proposal.changes);
      } else if (proposal.kind === 'delete') {
        await api.delete(`/panel/agents/${proposal.agentId}`);
      } else {
        await api.put(`/panel/prompt-versions/agent/${proposal.agentId}`, {
          content: proposal.content,
        });
      }
      updateMessageAt(conversationId, index, { proposalStatus: 'done' });
    } catch {
      updateMessageAt(conversationId, index, { proposalStatus: 'error' });
    }
  };

  const dismissProposal = (index: number) => {
    const conversationId = activeConversation?.id;
    if (!conversationId) return;
    updateMessageAt(conversationId, index, { proposalStatus: 'dismissed' });
  };

  const uploadFile = async (file: File) => {
    if (uploading) return;
    const attachmentLabel = t('assistant.attachmentLabel', { name: file.name });
    const conversationId = getOrCreateActiveId(companyId, attachmentLabel);
    appendMessages(conversationId, (prev) => [
      ...prev,
      { role: 'user', text: attachmentLabel },
    ]);
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/panel/knowledge/upload', form);
      appendMessages(conversationId, (prev) => [
        ...prev,
        {
          role: 'assistant',
          text: t('assistant.uploadSuccess', {
            title: data.title,
            chunks: data.chunks,
          }),
        },
      ]);
    } catch (e) {
      const message =
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? t('assistant.uploadError');
      appendMessages(conversationId, (prev) => [
        ...prev,
        { role: 'assistant', text: message },
      ]);
    } finally {
      setUploading(false);
    }
  };

  return {
    messages,
    conversations,
    activeConversationId: activeConversation?.id ?? null,
    draft,
    setDraft,
    sending,
    uploading,
    error,
    send,
    confirmProposal,
    dismissProposal,
    uploadFile,
    startNewConversation: () => startNew(companyId),
    openConversation: (id: string) => setActive(companyId, id),
  };
}
