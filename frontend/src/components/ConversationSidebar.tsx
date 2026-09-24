import { useTranslation } from 'react-i18next';
import { cn } from './ui';
import { PlusIcon } from './icons';
import type { Conversation } from '../hooks/useAssistantChat';

/**
 * Lista lateral de conversaciones del asistente (solo título) + botón para
 * empezar una nueva. Vive junto a AssistantConversation en la vista de
 * asistente a pantalla completa.
 */
export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <PlusIcon className="h-4 w-4" />
          {t('assistant.conversations.new')}
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto scrollbar-slim px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-slate-400">
            {t('assistant.conversations.empty')}
          </p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              title={c.title}
              className={cn(
                'block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition',
                c.id === activeId
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {c.title}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
