import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A small emoji or glyph shown beside the title. */
  icon?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {icon ? (
            <span aria-hidden className="text-2xl">
              {icon}
            </span>
          ) : null}
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
