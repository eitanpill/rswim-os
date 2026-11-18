import type { ReactNode } from 'react';
import { cn } from '../cn';

/** One number with its label, for a row of quick facts. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'brand' | 'ok' | 'warn' | 'danger';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3',
        tone === 'brand' && 'border-brand-100 bg-brand-50/60 dark:border-line dark:bg-surface',
        tone === 'ok' && 'border-ok/25 bg-ok/8',
        tone === 'warn' && 'border-warn/40 bg-warn/10',
        tone === 'danger' && 'border-danger/25 bg-danger/8',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-sm text-ink-muted">
        {icon ? <span aria-hidden>{icon}</span> : null}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
