import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@rswim/ui';
import { di } from './icons';
import { hueFor, initials } from './format';
import { CountUp } from './motion';

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
  spark,
  accent = 'sea',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Percent change; positive is good unless `invert`. */
  delta?: { pct: number; label: string } | null;
  icon?: ReactNode;
  testId?: string;
  /** A short trend (oldest first) drawn under the number. */
  spark?: number[];
  accent?: 'sea' | 'go' | 'coral' | 'sun';
}) {
  const color = {
    sea: 'var(--dive-sea)',
    go: 'var(--dive-go)',
    coral: 'var(--dive-coral)',
    sun: 'var(--dive-caution)',
  }[accent];
  return (
    <div
      data-testid={testId}
      className="lift relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised p-4"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {icon ? (
          <span
            className="inline-flex size-6 items-center justify-center rounded-lg [&_svg]:size-3.5"
            style={{ color, background: `color-mix(in oklch, ${color} 14%, transparent)` }}
          >
            {icon}
          </span>
        ) : null}
        {label}
      </p>
      <p className="mt-2 text-[1.7rem] leading-none font-bold tracking-tight tabular-nums">
        {typeof value === 'string' || typeof value === 'number' ? <CountUp value={value} /> : value}
      </p>
      {delta ? (
        <p className="mt-2 text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold',
              delta.pct >= 0
                ? 'bg-[color-mix(in_oklch,var(--dive-go)_14%,transparent)] text-[var(--dive-go)]'
                : 'bg-[color-mix(in_oklch,var(--dive-nogo)_12%,transparent)] text-[var(--dive-nogo)]',
            )}
          >
            <span aria-hidden="true">{delta.pct >= 0 ? '▲' : '▼'}</span>
            {Math.abs(delta.pct)}%
          </span>{' '}
          <span className="text-ink-muted">{delta.label}</span>
        </p>
      ) : sub ? (
        <p className="mt-2 text-xs text-ink-muted">{sub}</p>
      ) : null}
      {spark && spark.length > 1 ? <Spark values={spark} color={color} /> : null}
    </div>
  );
}

/** A tiny trend line with a soft fill; the last point is marked. Decorative, the number above carries the value. */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 6);
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const last = values.length - 1;
  return (
    <svg
      viewBox={`-2 0 ${w + 4} ${h}`}
      preserveAspectRatio="none"
      className="mt-3 h-7 w-full overflow-visible"
      aria-hidden="true"
    >
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(last)} cy={y(values[last] ?? 0)} r="3" fill={color} />
    </svg>
  );
}

/** Rising bubbles for the deep-water bands. Fixed positions, so server and browser draw the same picture. */
export function Bubbles({ count = 10 }: { count?: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const size = 4 + ((i * 7) % 11);
        return (
          <span
            key={i}
            className="bubble"
            style={{
              insetInlineStart: `${(i * 37 + 11) % 100}%`,
              width: size,
              height: size,
              animationDuration: `${7 + ((i * 5) % 9)}s`,
              animationDelay: `${-((i * 13) % 10)}s`,
            }}
          />
        );
      })}
    </span>
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
