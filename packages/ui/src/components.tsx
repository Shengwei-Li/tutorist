import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

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
