import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { personaName, type DevKey } from '@/lib/auth/dev';
import { ClubMark, di } from '../dive/_ui/icons';
import { Bubbles } from '../dive/_ui/kit';

const ROLE_ICON: Record<string, ReactNode> = {
  diveOwner: di.bridge,
  diveManager: di.ops,
  diveOffice: di.desk,
  diveInstructor: di.water,
  diveCustomer: di.me,
};

/**
 * The live demo's front door when it leads with the Eilat freediving club: the club's own deep-water landing, one big
 * way in as the owner, every other role a tap away, and the swim school and platform folded underneath.
 */
export async function DiveLanding({
  resetting,
  dive,
  others,
}: {
  resetting: boolean;
  dive: { key: DevKey; role: string; sees: string }[];
  others: { id: string; title: string; items: { key: DevKey; role: string; sees: string }[] }[];
}) {
  const t = await getTranslations('login.demo');
  const owner = dive[0];
  return (
    <div className="dive min-h-dvh bg-[var(--surface)]" data-surface="dive">
      <section className="bg-ocean relative overflow-hidden text-white">
        <span aria-hidden="true" className="light-rays pointer-events-none absolute inset-0" />
        <Bubbles count={18} />
        <svg
          aria-hidden="true"
          className="wave-drift pointer-events-none absolute -bottom-1 start-0 h-16 w-[200%]"
          viewBox="0 0 1200 40"
          preserveAspectRatio="none"
        >
          <path
            d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V40 H0 Z"
            fill="var(--surface)"
          />
        </svg>
        <div className="relative mx-auto max-w-6xl px-5 pt-6 pb-24 md:pt-8 md:pb-32">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ClubMark size={40} />
              <div>
                <p className="font-bold tracking-tight" data-testid="login-brand">
                  {t('landing.club')}
                </p>
                <p className="hidden text-xs text-white/70 sm:block">{t('landing.place')}</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-white/20">
              <span className="size-2 animate-pulse rounded-full bg-[var(--dive-go)]" />
              {t('landing.live')}
            </span>
          </div>

          <div className="mt-12 max-w-3xl md:mt-16">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--dive-shallow)]">
              {t('landing.kicker')}
            </p>
            <h1 className="mt-3 text-4xl leading-[1.1] font-bold tracking-tight md:text-6xl">
              {t('landing.title')}
            </h1>
            <p
              className="mt-4 max-w-2xl text-base text-white/80 md:text-lg"
              data-testid="demo-intro"
            >
              {t('landing.sub')}
            </p>
            {resetting ? (
              <p role="status" className="mt-4 rounded-xl bg-white/15 px-3 py-2 text-sm">
                {t('resetting')}
              </p>
            ) : null}
            {owner ? (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={`/dev/login?as=${owner.key}`}
                  className="group inline-flex min-h-14 items-center gap-3 rounded-2xl bg-white px-6 text-lg font-bold text-[var(--dive-abyss)] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.5)] transition-transform hover:-translate-y-0.5"
                  data-testid="enter-owner"
                >
                  {t('landing.enterOwner', { name: personaName(owner.key) })}
                  <span className="transition-transform group-hover:-translate-x-1 ltr:rotate-180 ltr:group-hover:translate-x-1">
                    ←
                  </span>
                </a>
                <a
                  href="#roles"
                  className="px-2 text-sm text-white/80 underline-offset-4 hover:underline"
                >
                  {t('landing.otherRoles')}
                </a>
              </div>
            ) : null}
            <ul className="mt-10 flex flex-wrap gap-2 text-sm">
              {(['sea', 'depth', 'ready', 'money'] as const).map((k) => (
                <li
                  key={k}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-white/90 ring-1 ring-white/15 backdrop-blur-sm"
                >
                  {t(`landing.feature.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <main className="relative mx-auto max-w-6xl px-5 pt-2 pb-16" data-testid="dev-login">
        <section id="roles" data-testid="demo-group-dive" className="scroll-mt-6">
          <h2 className="text-lg font-bold">{t('landing.rolesTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t('landing.rolesSub')}</p>
          <ul className="surface-in mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {dive.map(({ key, role, sees }) => (
              <li key={key}>
                <a
                  href={`/dev/login?as=${key}`}
                  className="lift flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-4"
                >
                  <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-[var(--dive-deep)] text-[var(--dive-shallow)] [&_svg]:size-6">
                    {ROLE_ICON[key]}
                  </span>
                  <span>
                    <span className="block font-bold">{role}</span>
                    <span className="block text-xs text-ink-muted">{personaName(key)}</span>
                  </span>
                  <span className="text-sm text-ink-muted">{sees}</span>
                  <span className="mt-auto text-sm font-semibold text-[var(--dive-sea)]">
                    {t('landing.enter')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <details className="mt-10 rounded-2xl border border-line bg-surface-raised p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t('landing.more')}</summary>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {others.map((g) => (
              <section
                key={g.id}
                data-testid={`demo-group-${g.id}`}
                className="flex flex-col gap-2"
              >
                <h3 className="text-xs font-semibold tracking-wide text-ink-muted">{g.title}</h3>
                {g.items.map(({ key, role, sees }) => (
                  <a
                    key={key}
                    href={`/dev/login?as=${key}`}
                    className="rounded-xl border border-line px-3 py-2 hover:bg-[color-mix(in_oklch,var(--dive-sea)_8%,transparent)]"
                  >
                    <span className="block font-medium">
                      {role}
                      <span className="font-normal text-ink-muted"> · {personaName(key)}</span>
                    </span>
                    <span className="text-sm text-ink-muted">{sees}</span>
                  </a>
                ))}
              </section>
            ))}
          </div>
        </details>
        <p className="mt-6 text-center text-xs text-ink-muted">{t('footnote')}</p>
      </main>
    </div>
  );
}
