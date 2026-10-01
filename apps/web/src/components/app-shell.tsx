import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Button } from '@rswim/ui';
import { setLocale } from '@/app/actions/locale';
import type { Session } from '@/lib/auth/types';
import { DesktopNav, MobileNav, type NavSpec } from './nav-bar';
import { OfflineBanner } from './offline-banner';

/** Shared frame for every signed-in surface: top bar, side nav (desktop), bottom nav (mobile). */
export async function AppShell({
  session,
  surface,
  nav,
  children,
}: {
  session: Session;
  surface: string;
  nav: NavSpec[];
  children: ReactNode;
}) {
  const t = await getTranslations('common');
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col" data-surface={surface}>
      <OfflineBanner />
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface-raised px-4 py-2">
        <div className="min-w-0">
          <p className="truncate font-semibold" data-testid="org-name">
            {session.orgName ?? 'R-SWIM OS'}
          </p>
          <p className="truncate text-xs text-ink-muted">
            {session.displayName ? `${session.displayName} · ` : ''}
            {session.role ? t(`role.${session.role}`) : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <form action={setLocale}>
            <input type="hidden" name="locale" value={locale === 'he' ? 'en' : 'he'} />
            <Button variant="ghost" type="submit" className="text-sm">
              {t('language')}
            </Button>
          </form>
          <form action="/auth/signout" method="post">
            <Button variant="secondary" type="submit" className="text-sm">
              {t('signOut')}
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        {nav.length > 0 ? <DesktopNav items={nav} label={t('mainNav')} /> : null}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-24 md:pb-8">{children}</main>
      </div>
      {nav.length > 0 ? <MobileNav items={nav} label={t('mainNav')} /> : null}
    </div>
  );
}
