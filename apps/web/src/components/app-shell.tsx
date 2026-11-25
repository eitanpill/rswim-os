import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PRODUCT } from '@rswim/contracts';
import { brandPalette, myBranding } from '@rswim/domain-platform';
import { Avatar, Button } from '@rswim/ui';
import { setLocale } from '@/app/actions/locale';
import { isDemoMode } from '@/lib/auth/dev';
import { canSwitchSchool } from '@/lib/auth/schools';
import type { Session } from '@/lib/auth/types';
import { withSession } from '@/lib/db';
import { icons } from './icons';
import { DesktopNav, MobileNav, type NavSpec } from './nav-bar';
import { OfflineBanner } from './offline-banner';

/**
 * Shared frame for every signed-in surface: top bar, side nav (desktop), bottom nav (mobile). Inside a school it
 * wears that school's name and brand colour.
 */
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
  const brand = session.orgId ? await withSession((tx) => myBranding(tx)) : {};
  const name = brand.displayName ?? session.orgName ?? brand.name ?? PRODUCT.name;
  const switcher = await canSwitchSchool(session);
  return (
    <div
      className="flex min-h-dvh flex-col"
      data-surface={surface}
      data-brand={brand.hue ?? undefined}
      style={brandPalette(brand.hue)}
    >
      <OfflineBanner />
      {isDemoMode() ? (
        <p
          className="bg-brand-600 px-4 py-1 text-center text-xs text-white print:hidden"
          data-testid="demo-banner"
        >
          {t('demoBanner')}
        </p>
      ) : null}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/70 bg-surface-raised/85 px-4 py-2 backdrop-blur-md print:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="bg-water grid size-9 shrink-0 place-items-center rounded-xl text-lg shadow-sm"
          >
            {[...name.trim()][0] ?? '🌊'}
          </span>
          <div className="min-w-0">
            <p className="truncate leading-tight font-semibold" data-testid="org-name">
              {name}
            </p>
            {/* The person's own account (store launch: deleting it is one tap away from every screen). */}
            <Link
              href="/me/account"
              className="block truncate text-xs text-ink-muted underline-offset-2 hover:underline"
              data-testid="my-account"
            >
              {[session.displayName, session.role ? t(`role.${session.role}`) : null]
                .filter(Boolean)
                .join(' · ')}
            </Link>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {switcher ? (
            <Link
              href="/me/schools"
              className="rounded-xl px-3 py-2 text-sm font-medium text-brand-ink hover:bg-brand-50"
              data-testid="switch-school"
            >
              {t('switchOrg')}
            </Link>
          ) : null}
          <form action={setLocale}>
            <input type="hidden" name="locale" value={locale === 'he' ? 'en' : 'he'} />
            <Button
              variant="ghost"
              type="submit"
              className="gap-1 px-2.5 text-sm text-ink-muted"
              aria-label={t('language')}
              title={t('language')}
            >
              <span aria-hidden className="[&_svg]:size-5">
                {icons.globe}
              </span>
              <span aria-hidden className="text-xs font-semibold">
                {locale === 'he' ? 'EN' : 'עב'}
              </span>
            </Button>
          </form>
          <Link
            href="/me/account"
            aria-label={t('myAccount')}
            className="hidden rounded-full sm:block"
          >
            <Avatar name={session.displayName ?? name} size="sm" />
          </Link>
          <form action="/auth/signout" method="post">
            <Button
              variant="ghost"
              type="submit"
              className="px-2.5 text-ink-muted hover:text-danger-ink"
              aria-label={t('signOut')}
              title={t('signOut')}
            >
              <span aria-hidden className="[&_svg]:size-5">
                {icons.exit}
              </span>
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        {nav.length > 0 ? (
          <div className="contents print:hidden">
            <DesktopNav items={nav} label={t('mainNav')} />
          </div>
        ) : null}
        <main className="page-in mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 md:pb-8 print:p-0">
          {children}
        </main>
      </div>
      {nav.length > 0 ? (
        <div className="contents print:hidden">
          <MobileNav items={nav} label={t('mainNav')} />
        </div>
      ) : null}
    </div>
  );
}
