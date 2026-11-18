import type { ReactNode } from 'react';

/** A friendly "nothing here (yet)" block: an icon in a floating bubble, a title, a hint and an optional action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-ink-muted">
      <div
        className="pop-in grid size-14 place-items-center rounded-full bg-brand-50 text-2xl ring-4 ring-brand-50/50 dark:bg-surface dark:ring-surface/50"
        aria-hidden
      >
        <span className="bob">{icon ?? '🫧'}</span>
      </div>
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="max-w-xs text-sm">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
