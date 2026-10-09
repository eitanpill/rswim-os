import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { seaOutlook } from '@rswim/domain-dive';
import { setLocale } from '@/app/actions/locale';
import { isDemoMode } from '@/lib/auth/dev';
import type { Session } from '@/lib/auth/types';
import { withSession } from '@/lib/db';
import { pagesFor, type DivePage, type DiveRole } from './access';
import { ClubMark, di } from './icons';
import { Avatar, CallBadge } from './kit';
import { DiveNav } from './nav';

const PAGE_ICON: Record<DivePage, ReactNode> = {
  owner: di.bridge,
  manager: di.ops,
  office: di.desk,
  instructor: di.water,
  me: di.me,
  divers: di.divers,
};

/**
 * The club's frame: a deep-water band with the club, today's sea call, who is signed in and one tab per screen the
 * role may open. The owner sees every staff screen, so "view as" is just the tabs.
 */
export async function DiveShell({
  session,
  role,
  children,
}: {
  session: Session;
  role: DiveRole;
  children: ReactNode;
}) {
  const t = await getTranslations('dive');
  const tc = await getTranslations('common');
  const locale = await getLocale();
  const sea = await withSession((tx) => seaOutlook(tx, 0));
  const items = pagesFor(role).map((p) => ({
    href: `/dive/${p}`,
    label: t(`nav.${p}`),
    icon: PAGE_ICON[p],
  }));
  return (
    <div className="dive flex min-h-dvh flex-col bg-[var(--surface)]" data-surface="dive">
      {isDemoMode() ? (
        <p
          className="bg-[var(--dive-coral)] px-4 py-1 text-center text-xs font-medium text-white print:hidden"
          data-testid="demo-banner"
        >
          {tc('demoBanner')}
        </p>
      ) : null}
      <header className="bg-ocean relative overflow-hidden text-white print:hidden">
        <svg
          aria-hidden="true"
          className="wave-drift pointer-events-none absolute -bottom-1 start-0 h-10 w-[200%] opacity-20"
          viewBox="0 0 1200 40"
          preserveAspectRatio="none"
        >
          <path
            d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V40 H0 Z"
            fill="white"
          />
        </svg>
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <ClubMark size={38} />
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-tight" data-testid="org-name">
                {session.orgName ?? t('clubFallback')}
              </p>
              <p className="truncate text-xs text-white/70">{t('tagline')}</p>
            </div>
            {sea.today ? (
              <span className="ms-2 hidden sm:inline-flex" data-testid="shell-call">
                <CallBadge call={sea.today.call} label={t(`call.${sea.today.call}`)} size="sm" />
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <Avatar name={session.displayName ?? '?'} size={30} />
              <div className="leading-tight">
                <p className="text-sm font-medium">{session.displayName}</p>
                <p className="text-[11px] text-white/65">{t(`roles.${role}`)}</p>
              </div>
            </div>
            <form action={setLocale}>
              <input type="hidden" name="locale" value={locale === 'he' ? 'en' : 'he'} />
              <button
                type="submit"
                className="min-h-tap rounded-xl px-2.5 text-sm text-white/85 hover:bg-white/10"
              >
                {tc('language')}
              </button>
            </form>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={tc('signOut')}
                title={tc('signOut')}
                className="inline-flex min-h-tap items-center gap-1.5 rounded-xl border border-white/20 px-2.5 text-sm hover:bg-white/10"
              >
                <span className="rtl:-scale-x-100">{di.out}</span>
                <span className="hidden sm:inline">{tc('signOut')}</span>
              </button>
            </form>
          </div>
        </div>
        {items.length > 1 ? (
          <div className="relative mx-auto max-w-7xl px-4">
            <DiveNav items={items} label={tc('mainNav')} />
          </div>
        ) : (
          <div className="h-3" />
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-16">{children}</main>
      <footer className="border-t border-line py-4 text-center text-xs text-ink-muted print:hidden">
        {t('footer')}
      </footer>
    </div>
  );
}
