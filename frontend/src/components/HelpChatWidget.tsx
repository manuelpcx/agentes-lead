import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatIcon, CloseIcon } from './icons';
import { AssistantConversation } from './AssistantConversation';
import { useAssistantChat } from '../hooks/useAssistantChat';

/**
 * Burbuja flotante del asistente, disponible en todo el panel excepto en la
 * página de inicio (que ya es el chat a pantalla completa — ver
 * AssistantHomePage). Misma lógica que la vista principal, vía
 * useAssistantChat; esto solo aporta la presentación flotante.
 */
export function HelpChatWidget() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chat = useAssistantChat();

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-200 bg-brand-600 px-4 py-3">
            <span className="text-sm font-semibold text-white">
              {t('assistant.widgetTitle')}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white"
              aria-label={t('assistant.closeAria')}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

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
            inputPlaceholder={t('assistant.inputPlaceholderShort')}
            dense
          />
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-card transition hover:bg-brand-700"
        aria-label={open ? t('assistant.closeAria') : t('assistant.openAria')}
      >
        {open ? (
          <CloseIcon className="h-6 w-6" />
        ) : (
          <ChatIcon className="h-6 w-6" />
        )}
      </button>
    </>
  );
}
