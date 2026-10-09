import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@rswim/ui';
import { di } from './icons';
import { hueFor, initials } from './format';

/** The club's building blocks: panels, numbers, badges, chips and meters. Server components, no client state. */

export type Tone = 'go' | 'caution' | 'nogo' | 'info' | 'muted' | 'sea';

const TONE: Record<Tone, string> = {
  go: 'bg-[color-mix(in_oklch,var(--dive-go)_14%,transparent)] text-[var(--dive-go)] ring-[color-mix(in_oklch,var(--dive-go)_35%,transparent)]',
  caution:
    'bg-[color-mix(in_oklch,var(--dive-caution)_16%,transparent)] text-[color-mix(in_oklch,var(--dive-caution)_70%,var(--ink))] ring-[color-mix(in_oklch,var(--dive-caution)_40%,transparent)]',
  nogo: 'bg-[color-mix(in_oklch,var(--dive-nogo)_13%,transparent)] text-[var(--dive-nogo)] ring-[color-mix(in_oklch,var(--dive-nogo)_35%,transparent)]',
  info: 'bg-[color-mix(in_oklch,var(--dive-sea)_13%,transparent)] text-[color-mix(in_oklch,var(--dive-sea)_70%,var(--ink))] ring-[color-mix(in_oklch,var(--dive-sea)_35%,transparent)]',
  sea: 'bg-[var(--dive-deep)] text-white ring-transparent',
  muted: 'bg-[color-mix(in_oklch,var(--ink)_6%,transparent)] text-ink-muted ring-line',
};

const TONE_ICON: Record<Tone, ReactNode> = {
  go: di.check,
  caution: di.bang,
  nogo: di.x,
  info: null,
  sea: null,
  muted: null,
};

export function Chip({
  tone = 'muted',
  icon,
  children,
  title,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode | false;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const glyph = icon === false ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE[tone],
        className,
      )}
    >
      {glyph ? <span className="-ms-0.5 inline-flex [&_svg]:size-3.5">{glyph}</span> : null}
      {children}
    </span>
  );
}

export function Panel({
  title,
  icon,
  action,
  children,
  className,
  testId,
  flush,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  /** No inner padding (tables, lists that run to the edge). */
  flush?: boolean;
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'min-w-0 rounded-2xl border border-line bg-surface-raised shadow-[0_1px_2px_oklch(20%_0.05_240/0.06),0_8px_24px_-12px_oklch(30%_0.08_230/0.18)]',
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ink">
            {icon ? (
              <span className="text-[var(--dive-sea)] [&_svg]:size-[18px]">{icon}</span>
            ) : null}
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      <div className={flush ? '' : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  icon,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Percent change; positive is good unless `invert`. */
  delta?: { pct: number; label: string } | null;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="relative overflow-hidden rounded-2xl border border-line bg-surface-raised p-4"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {icon ? <span className="text-[var(--dive-sea)] [&_svg]:size-4">{icon}</span> : null}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {delta ? (
        <p className="mt-1 text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-semibold',
              delta.pct >= 0 ? 'text-[var(--dive-go)]' : 'text-[var(--dive-nogo)]',
            )}
          >
            <span aria-hidden="true">{delta.pct >= 0 ? '▲' : '▼'}</span>
            {Math.abs(delta.pct)}%
          </span>{' '}
          <span className="text-ink-muted">{delta.label}</span>
        </p>
      ) : sub ? (
        <p className="mt-1 text-xs text-ink-muted">{sub}</p>
      ) : null}
    </div>
  );
}

/** A big go / caution / no-go badge: colour, icon and word together. */
export function CallBadge({
  call,
  label,
  size = 'md',
}: {
  call: 'go' | 'caution' | 'no_go';
  label: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone: Tone = call === 'go' ? 'go' : call === 'caution' ? 'caution' : 'nogo';
  return (
    <Chip
      tone={tone}
      className={cn(
        size === 'lg' && 'px-3 py-1 text-sm [&_svg]:size-4',
        size === 'sm' && 'px-1.5 text-[11px]',
      )}
    >
      {label}
    </Chip>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const h = hueFor(name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, oklch(70% 0.1 ${h}), oklch(50% 0.12 ${(h + 40) % 360}))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** A thin fill bar (booked of capacity, skills done, …). */
export function Meter({
  value,
  max,
  tone = 'sea',
  label,
}: {
  value: number;
  max: number;
  tone?: 'sea' | 'go' | 'caution' | 'nogo';
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = {
    sea: 'var(--dive-sea)',
    go: 'var(--dive-go)',
    caution: 'var(--dive-caution)',
    nogo: 'var(--dive-nogo)',
  }[tone];
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      title={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink)_8%,transparent)]"
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-[color-mix(in_oklch,var(--ink)_5%,transparent)] p-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? 'page' : undefined}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm whitespace-nowrap',
            i.active
              ? 'bg-surface-raised font-semibold shadow-sm'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-muted">{children}</p>;
}

/** The page's opening line: a title with a quiet subtitle and room for actions. */
export function Hero({
  kicker,
  title,
  sub,
  aside,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker ? (
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--dive-sea)] uppercase">
            {kicker}
          </p>
        ) : null}
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-ink-muted">{sub}</p> : null}
      </div>
      {aside}
    </div>
  );
}

export const btn = {
  primary:
    'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-xl bg-[var(--dive-deep)] px-4 text-sm font-semibold text-white hover:bg-[var(--dive-abyss)] disabled:opacity-50',
  ghost:
    'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-[color-mix(in_oklch,var(--ink)_5%,transparent)]',
};
