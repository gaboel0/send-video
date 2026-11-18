import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

/** Hashtags como fichas: Enter, espaço, vírgula ou colar uma lista */
export function HashtagInput({ value, onChange, id, max }: { value: string[]; onChange: (v: string[]) => void; id?: string; max?: number }) {
  const [draft, setDraft] = useState('');
  const commit = (raw: string) => {
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, '').trim())
      .filter(Boolean);
    if (!tags.length) return;
    const next = [...value];
    for (const t of tags) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    onChange(next);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ' ', ','].includes(e.key)) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const over = max !== undefined && value.length > max;
  return (
    <div
      className={`input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:outline-2 focus-within:outline-focus ${over ? 'border-danger' : ''}`}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-[5px] bg-paper-2 pr-1 pl-2 text-xs text-ink-2">
          #{t}
          <button type="button" aria-label={`Remover #${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 text-muted hover:text-ink">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[\s,#]/.test(text)) {
            e.preventDefault();
            commit(text);
          }
        }}
        placeholder={value.length ? '' : 'Digite e pressione Enter'}
        className="min-w-24 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-faint"
      />
    </div>
  );
}
