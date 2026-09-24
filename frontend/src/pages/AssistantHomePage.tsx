import { useTranslation } from 'react-i18next';
import { AssistantConversation } from '../components/AssistantConversation';
import { ConversationSidebar } from '../components/ConversationSidebar';
import { PlusIcon } from '../components/icons';
import { useAssistantChat } from '../hooks/useAssistantChat';

/**
 * Vista principal del panel (home tras el login): el asistente conversacional
 * a pantalla completa, con una lista lateral de conversaciones anteriores
 * (solo título, clic para reabrir) y un botón para empezar una nueva —
 * reemplaza la Bandeja como punto de entrada. La Bandeja sigue disponible
 * desde el menú (ver AppLayout) para quien ya sabe a qué lead quiere ir
 * directo.
 */
export function AssistantHomePage() {
  const { t } = useTranslation();
  const chat = useAssistantChat();
  const isNewConversation = chat.activeConversationId === null;
  const suggestions = t('assistant.suggestions', { returnObjects: true }) as string[];

  return (
    <div className="flex h-full min-h-0">
      <ConversationSidebar
        conversations={chat.conversations}
        activeId={chat.activeConversationId}
        onSelect={chat.openConversation}
        onNew={chat.startNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* En mobile no hay sidebar (ver ConversationSidebar); esta fila
            cumple lo mismo: cambiar de conversación o empezar una nueva. */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 md:hidden">
          <select
            value={chat.activeConversationId ?? ''}
            onChange={(e) =>
              e.target.value
                ? chat.openConversation(e.target.value)
                : chat.startNewConversation()
            }
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">{t('assistant.conversations.new')}</option>
            {chat.conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            onClick={chat.startNewConversation}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
            aria-label={t('assistant.conversations.new')}
            title={t('assistant.conversations.new')}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {isNewConversation && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-8">
            <h1 className="text-xl font-semibold text-slate-900">
              {t('assistant.homeTitle')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t('assistant.homeSubtitle')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => chat.send(s)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand-300 hover:text-brand-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AssistantConversation
          messages={chat.messages}
          draft={chat.draft}
          setDraft={chat.setDraft}
          sending={chat.sending}
          uploading={chat.uploading}
          error={chat.error}
          onSend={chat.send}
          onConfirmProposal={chat.confirmProposal}
          onDismissProposal={chat.dismissProposal}
          onUploadFile={chat.uploadFile}
        />
      </div>
    </div>
  );
}
