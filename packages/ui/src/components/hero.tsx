import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * The top of a role's home screen: a water-coloured card in the school's brand hue with a greeting, one line of
 * context, and the next thing to do. Decorative bubbles are aria-hidden and still under reduced motion.
 */
export function Hero({
  eyebrow,
  title,
  children,
  actions,
  emoji,
  className,
  ...rest
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  emoji?: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <section
      className={cn(
        'bg-water relative isolate overflow-hidden rounded-card p-5 shadow-[var(--shadow-pop)]',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className="absolute -end-6 -top-6 -z-10 size-28 rounded-full border border-white/25 bg-white/10"
      />
      <span
        aria-hidden
        className="absolute end-16 top-10 -z-10 size-6 rounded-full border border-white/40 bg-white/15"
      />
      <span
        aria-hidden
        className="absolute -bottom-10 start-1/3 -z-10 size-24 rounded-full bg-white/10"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="text-sm font-medium text-white/85">{eyebrow}</p> : null}
          <h2 className="mt-0.5 text-2xl leading-tight font-bold">{title}</h2>
        </div>
        {emoji ? (
          <span aria-hidden className="bob shrink-0 text-4xl leading-none drop-shadow">
            {emoji}
          </span>
        ) : null}
      </div>
      {children ? <div className="mt-2 text-white/95">{children}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
