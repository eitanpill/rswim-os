import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-card border border-line/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)]',
        className,
      )}
      {...props}
    />
  );
}

/** A card heading; `icon` is a small emoji or glyph in a soft bubble that makes the card easy to spot. */
export function CardTitle({
  children,
  aside,
  icon,
}: {
  children: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {icon ? (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-base"
          >
            {icon}
          </span>
        ) : null}
        {children}
      </h2>
      {aside}
    </header>
  );
}
