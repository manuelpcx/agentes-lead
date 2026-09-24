import { Fragment, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './ui';

/**
 * Renderizador de Markdown mínimo, hecho a medida de nuestras guías.
 *
 * No usamos `react-markdown` porque el árbol de dependencias del repo está en
 * conflicto (npm/pnpm) y agregar paquetes rompe `node_modules` — igual que con
 * el parser de CSV de la importación y el servidor MCP.
 *
 * Cubre exactamente lo que escribimos en `src/content/*.md`: títulos,
 * párrafos, listas, tablas, bloques de código, citas, separadores y, en línea,
 * negrita, cursiva, `código` y enlaces. Cualquier otra cosa se muestra como
 * texto plano en vez de romperse.
 */

// ─────────────────────────── inline ───────────────────────────

/** `código` | [texto](url) | **negrita** | *cursiva*, en ese orden de prioridad. */
const INLINE =
  /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `i${i++}`;
    if (token.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-700"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token) ?? [];
      const external = /^https?:\/\//.test(href ?? '');
      out.push(
        <a
          key={key}
          href={href}
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          className="font-medium text-brand-600 underline decoration-brand-200 underline-offset-2 hover:text-brand-700"
        >
          {label}
        </a>,
      );
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ─────────────────────────── bloques ───────────────────────────

type Block =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

/** Ancla estable para el índice lateral. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const splitRow = (line: string): string[] =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    // Bloque de código: todo literal hasta el cierre.
    if (trimmed.startsWith('```')) {
      flushParagraph();
      const lang = trimmed.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang, code: code.join('\n') });
      continue;
    }

    // Tabla: cabecera + separador + filas.
    if (
      trimmed.startsWith('|') &&
      lines[i + 1] &&
      /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1])
    ) {
      flushParagraph();
      const head = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      i--;
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const text = heading[2].trim();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text,
        id: slugify(text),
      });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }

    const bullet = /^([-*]|\d+\.)\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const next = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(current);
        if (next) {
          items.push(next[2]);
        } else if (/^\s+\S/.test(current) && items.length > 0) {
          // Continuación de un ítem que venía envuelto en varias líneas.
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        i++;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

// ─────────────────────────── componentes ───────────────────────────

function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Portapapeles bloqueado: el código igual está a la vista.
    }
  };
  return (
    <div className="group relative my-3">
      <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className={cn(
          'absolute right-2 top-2 rounded-lg px-2 py-1 text-[11px] font-medium',
          'bg-slate-700/80 text-slate-100 opacity-0 transition',
          'hover:bg-slate-600 focus:opacity-100 group-hover:opacity-100',
        )}
      >
        {copied ? `✓ ${t('common.copied')}` : t('common.copy')}
      </button>
    </div>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-0 mb-2 text-xl font-semibold text-slate-900',
  2: 'mt-7 mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-900',
  3: 'mt-5 mb-1.5 text-sm font-semibold text-slate-800',
  4: 'mt-4 mb-1 text-sm font-medium text-slate-700',
};

/** Títulos de nivel 2, para armar un índice lateral. */
export function headings(md: string): { id: string; text: string }[] {
  return parseMarkdown(md)
    .filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading')
    .filter((b) => b.level === 2)
    .map(({ id, text }) => ({ id, text }));
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="text-sm leading-relaxed text-slate-600">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${Math.min(block.level, 4)}` as 'h1';
            return (
              <Tag
                key={i}
                id={block.id}
                className={cn('scroll-mt-4', HEADING_CLASS[block.level])}
              >
                {renderInline(block.text)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={i} className="my-2.5">
                {renderInline(block.text)}
              </p>
            );
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={i}
                className={cn(
                  'my-2.5 space-y-1 pl-5',
                  block.ordered ? 'list-decimal' : 'list-disc',
                )}
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-0.5">
                    {renderInline(item)}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'code':
            return <CodeBlock key={i} code={block.code} />;
          case 'table':
            return (
              <div
                key={i}
                className="my-3 overflow-x-auto rounded-xl border border-slate-200"
              >
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {block.head.map((h, j) => (
                        <th key={j} className="px-3 py-2 font-medium">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {block.rows.map((row, j) => (
                      <tr key={j} className="align-top">
                        {row.map((cell, k) => (
                          <td key={k} className="px-3 py-2">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'quote':
            return (
              <blockquote
                key={i}
                className="my-3 rounded-r-xl border-l-4 border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          case 'hr':
            return <hr key={i} className="my-6 border-slate-200" />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}
