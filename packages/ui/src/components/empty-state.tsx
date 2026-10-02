import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-ink-muted">
      {icon ? (
        <div className="text-3xl" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="text-sm">{children}</div> : null}
    </div>
  );
}
