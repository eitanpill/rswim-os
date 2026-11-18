import type { ReactNode } from 'react';

const BUBBLES = [
  { start: '8%', size: 10, delay: '0s' },
  { start: '22%', size: 16, delay: '2.5s' },
  { start: '41%', size: 8, delay: '5s' },
  { start: '63%', size: 14, delay: '1.2s' },
  { start: '80%', size: 9, delay: '3.8s' },
  { start: '92%', size: 18, delay: '6.2s' },
];

function Waves({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
      <path
        fill="var(--color-surface, white)"
        d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V 40 H 0 Z"
      />
    </svg>
  );
}

/** Bubbles and waves behind a block that has the `aqua-hero` class. */
export function WaterBand() {
  return (
    <>
      {BUBBLES.map((b) => (
        <span
          key={b.start}
          className="aqua-bubble"
          style={{
            insetInlineStart: b.start,
            width: b.size,
            height: b.size,
            animationDelay: b.delay,
          }}
          aria-hidden="true"
        />
      ))}
      <Waves className="aqua-waves slow" />
      <Waves className="aqua-waves" />
    </>
  );
}

/** A band of moving water for the top of the sign-up and onboarding screens. */
export function AquaHero({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="aqua-hero mb-6 rounded-card px-5 pb-12 pt-6" data-testid="aqua-hero">
      <WaterBand />
      <div className="flex items-start gap-4">
        {icon ? (
          <span className="aqua-float text-5xl leading-none" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle ? <p className="text-white/90">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </header>
  );
}

/** Where the owner is in opening the business: the account, the business, the card. */
export function SignupSteps({
  current,
  labels,
}: {
  current: 1 | 2 | 3;
  labels: [string, string, string];
}) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="signup-steps">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : 'next';
        return (
          <li key={label} className="flex items-center gap-2" data-state={state}>
            <span
              className={
                state === 'next'
                  ? 'grid size-6 place-items-center rounded-full border border-white/60 text-white/80'
                  : 'grid size-6 place-items-center rounded-full bg-white font-bold text-brand-700'
              }
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span className={state === 'now' ? 'font-semibold' : 'text-white/85'}>{label}</span>
            {n < 3 ? (
              <span className="text-white/60" aria-hidden="true">
                ·
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
