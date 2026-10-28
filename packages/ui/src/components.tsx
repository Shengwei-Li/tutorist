import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

/** Three button levels; at most one primary per screen (SPEC §8.4). */
export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover',
        variant === 'secondary' && 'border border-border-strong bg-surface text-text hover:bg-surface-2',
        variant === 'ghost' && 'text-text-2 hover:bg-surface-2 hover:text-text',
        className,
      )}
      {...rest}
    />
  );
}

export type Status = 'pending' | 'progress' | 'done' | 'error';
const STATUS_GLYPH: Record<Status, string> = { pending: '○', progress: '◐', done: '●', error: '×' };

/** Status as glyph + text, never a coloured pill. */
export function StatusMark({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-sm', status === 'error' ? 'text-danger' : 'text-text-2')}>
      <span aria-hidden className={clsx(status === 'done' && 'text-text', status === 'progress' && 'text-accent')}>
        {STATUS_GLYPH[status]}
      </span>
      {children}
    </span>
  );
}

/** Flat section separated by a 1px border; no shadow. */
export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-md border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex h-10 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-text-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-3">{hint}</span>}
    </label>
  );
}

const inputCls =
  'h-8 rounded-sm border border-border-strong bg-surface px-2 text-sm text-text placeholder:text-text-3 focus:border-accent focus:outline-none';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputCls, className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(inputCls, 'pr-6', className)} {...rest} />;
}

/** One sentence and one action; no illustration (SPEC §8.4). */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6 text-sm text-text-2">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-3">{k}</dt>
          <dd className="text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputCls, 'h-auto py-1.5 leading-relaxed', className)} {...rest} />;
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
  testId?: string;
}

/** A "…" button opening a short list of actions; closes on choice, outside click or Escape. */
export function Menu({ items, label, testId }: { items: MenuItem[]; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 min-w-44 whitespace-nowrap rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-float)]">
          {items.map((it) => (
            <div key={it.label}>
              {it.separated && <div className="my-1 border-t border-border" />}
              <button
                type="button"
                role="menuitem"
                data-testid={it.testId}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onSelect();
                }}
                className={clsx('flex h-8 w-full items-center px-3 text-left text-sm hover:bg-surface-2', it.danger ? 'text-danger' : 'text-text')}
              >
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A modal sheet: title, body, actions on the right. Escape or a click on the backdrop closes it. */
export function Dialog({ title, children, actions, onClose, wide }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 px-4 py-12" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className={clsx('flex max-h-full w-full flex-col rounded-md border border-border bg-surface shadow-[var(--shadow-float)]', wide ? 'max-w-2xl' : 'max-w-md')}>
        <header className="flex h-11 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-sm font-semibold">{title}</h2>
        </header>
        <div className="min-h-0 overflow-auto px-5 py-4">{children}</div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">{actions}</footer>
      </div>
    </div>
  );
}
