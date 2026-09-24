import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './ui';
import { PaperclipIcon, SendIcon } from './icons';
import type { AgentProposal, ChatMessage } from '../hooks/useAssistantChat';

const ACCEPTED_EXTENSIONS = '.txt,.md,.csv,.json';

function fieldValue(t: (key: string) => string, value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : t('assistant.proposal.anyValue');
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
  return String(value);
}

function ProposalCard({
  proposal,
  status,
  onConfirm,
  onDismiss,
}: {
  proposal: AgentProposal;
  status: ChatMessage['proposalStatus'];
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const destructive = proposal.kind === 'delete';

  const typeLabels = t('assistant.typeLabels', {
    returnObjects: true,
  }) as Record<string, string>;

  const fieldLabels: Record<string, string> = {
    name: t('assistant.proposal.fieldName'),
    description: t('assistant.proposal.fieldDescription'),
    channels: t('assistant.proposal.fieldChannels'),
    leadStates: t('assistant.proposal.fieldLeadStates'),
    isDefault: t('assistant.proposal.fieldIsDefault'),
    isActive: t('assistant.proposal.fieldIsActive'),
  };

  return (
    <div
      className={cn(
        'max-w-[92%] rounded-xl border p-3 text-sm',
        destructive
          ? 'border-rose-200 bg-rose-50'
          : 'border-brand-200 bg-brand-50',
      )}
    >
      {proposal.kind === 'create' && (
        <>
          <p className="font-semibold text-slate-800">{proposal.name}</p>
          <p className="text-xs text-slate-500">
            {t('assistant.proposal.createType', {
              type: typeLabels[proposal.type] ?? proposal.type,
            })}
          </p>
          {proposal.description && (
            <p className="mt-1 text-xs text-slate-600">
              {proposal.description}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {fieldLabels.channels}:{' '}
            {proposal.channels?.join(', ') || t('assistant.proposal.anyValue')}
          </p>
          <p className="text-xs text-slate-500">
            {fieldLabels.leadStates}:{' '}
            {proposal.leadStates?.join(', ') || t('assistant.proposal.anyValue')}
          </p>
          {proposal.isDefault && (
            <p className="text-xs text-slate-500">
              {t('assistant.proposal.createDefaultNote')}
            </p>
          )}
        </>
      )}

      {proposal.kind === 'update' && (
        <>
          <p className="font-semibold text-slate-800">
            {t('assistant.proposal.editTitle', { name: proposal.agentName })}
          </p>
          <div className="mt-1 space-y-0.5">
            {Object.entries(proposal.changes).map(([key, value]) => (
              <p key={key} className="text-xs text-slate-600">
                <span className="text-slate-500">
                  {fieldLabels[key] ?? key}:
                </span>{' '}
                {fieldValue(t, value)}
              </p>
            ))}
          </div>
        </>
      )}

      {proposal.kind === 'delete' && (
        <>
          <p className="font-semibold text-rose-700">
            {t('assistant.proposal.deleteTitle', { name: proposal.agentName })}
          </p>
          <p className="mt-1 text-xs text-rose-600">
            {t('assistant.proposal.deleteWarning')}
            {proposal.reason
              ? t('assistant.proposal.deleteReason', { reason: proposal.reason })
              : ''}
          </p>
        </>
      )}

      {proposal.kind === 'prompt' && (
        <>
          <p className="font-semibold text-slate-800">
            {t('assistant.proposal.promptTitle', { name: proposal.agentName })}
          </p>
          {proposal.summary && (
            <p className="mt-1 text-xs text-slate-600">{proposal.summary}</p>
          )}
          <pre className="mt-2 max-h-48 overflow-auto scrollbar-slim whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-slate-700">
            {proposal.content}
          </pre>
        </>
      )}

      {status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium text-white',
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {proposal.kind === 'create' && t('assistant.proposal.createBtn')}
            {proposal.kind === 'update' && t('assistant.proposal.updateBtn')}
            {proposal.kind === 'delete' && t('assistant.proposal.deleteBtn')}
            {proposal.kind === 'prompt' && t('assistant.proposal.promptBtn')}
          </button>
          <button
            onClick={onDismiss}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {proposal.kind === 'delete'
              ? t('assistant.proposal.cancelBtn')
              : t('assistant.proposal.dismissBtn')}
          </button>
        </div>
      )}
      {status === 'working' && (
        <p className="mt-2 text-xs text-slate-400">
          {t('assistant.proposal.working')}
        </p>
      )}
      {status === 'done' && (
        <p className="mt-2 text-xs font-medium text-emerald-600">
          {proposal.kind === 'create' && t('assistant.proposal.doneCreate')}
          {proposal.kind === 'update' && t('assistant.proposal.doneUpdate')}
          {proposal.kind === 'delete' && t('assistant.proposal.doneDelete')}
          {proposal.kind === 'prompt' && t('assistant.proposal.donePrompt')}
        </p>
      )}
      {status === 'dismissed' && (
        <p className="mt-2 text-xs text-slate-400">
          {t('assistant.proposal.dismissed')}
        </p>
      )}
      {status === 'error' && (
        <div className="mt-2">
          <p className="text-xs text-rose-600">
            {t('assistant.proposal.errorRetry')}
          </p>
          <button
            onClick={onConfirm}
            className="mt-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Mensajes + input, sin el contenedor exterior — el widget flotante y la
 * página completa deciden el tamaño/posición, esto es el contenido en común.
 */
export function AssistantConversation({
  messages,
  draft,
  setDraft,
  sending,
  uploading = false,
  error,
  onSend,
  onConfirmProposal,
  onDismissProposal,
  onUploadFile,
  inputPlaceholder,
  dense = false,
}: {
  messages: ChatMessage[];
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  uploading?: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onConfirmProposal: (index: number) => void;
  onDismissProposal: (index: number) => void;
  onUploadFile?: (file: File) => void;
  inputPlaceholder?: string;
  dense?: boolean;
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(draft);
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && onUploadFile) {
      onUploadFile(file);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  // flex-1 (y no h-full): arriba puede haber hermanos — el selector de
  // conversación en móvil y las sugerencias — y h-full los ignoraría,
  // desbordando el contenedor y empujando el campo de escribir fuera de vista.
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!onUploadFile) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onUploadFile ? onDrop : undefined}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/90">
          <p className="text-sm font-medium text-brand-700">
            {t('assistant.dropHint')}
          </p>
        </div>
      )}
      <div
        className={cn(
          'flex-1 space-y-2 overflow-y-auto scrollbar-slim',
          dense ? 'p-3' : 'mx-auto w-full max-w-2xl px-4 py-6',
        )}
      >
        {messages.map((m, i) => (
          <div key={i} className="space-y-2">
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'ml-auto bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-700',
              )}
            >
              {m.text}
            </div>
            {m.proposal && (
              <ProposalCard
                proposal={m.proposal}
                status={m.proposalStatus}
                onConfirm={() => onConfirmProposal(i)}
                onDismiss={() => onDismissProposal(i)}
              />
            )}
          </div>
        ))}
        {sending && (
          <div className="max-w-[85%] rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-400">
            {t('assistant.typing')}
          </div>
        )}
        {uploading && (
          <div className="ml-auto max-w-[85%] rounded-xl bg-brand-600/80 px-3 py-2 text-sm text-white">
            {t('assistant.uploading')}
          </div>
        )}
        {error && (
          <div className="max-w-[85%] rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className={cn(
          'flex items-center gap-2 border-t border-slate-200 p-2',
          !dense && 'mx-auto w-full max-w-2xl px-4 py-3',
        )}
      >
        {onUploadFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={onFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              aria-label={t('assistant.uploadAria')}
              title={t('assistant.uploadTitle')}
            >
              <PaperclipIcon className="h-4 w-4" />
            </button>
          </>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={inputPlaceholder ?? t('assistant.inputPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-50"
          aria-label={t('assistant.sendAria')}
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
