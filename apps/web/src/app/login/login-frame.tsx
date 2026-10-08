import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { brandingForHost, brandPalette } from '@rswim/domain-platform';
import { demoProfile } from '@rswim/db/demo-profiles';
import { isDemoMode } from '@/lib/auth/dev';
import { withAnon } from '@/lib/db';

/** On a school's own verified domain, sign-in wears that school's name and colour. */
async function hostBranding() {
  const host = (await headers()).get('host');
  if (!host || !process.env.DATABASE_URL) return null;
  return withAnon((tx) => brandingForHost(tx, host));
}

export async function LoginFrame({
  title,
  error,
  children,
}: {
  title: string;
  error?: string;
  children: ReactNode;
}) {
  const t = await getTranslations();
  const known = ['invalid', 'phone', 'code', 'no_membership', 'not_configured'];
  const brand = await hostBranding();
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10"
      style={brandPalette(brand?.hue)}
      data-brand={brand?.hue ?? undefined}
    >
      <div className="text-center" data-testid="login-brand">
        <p className="text-3xl font-bold text-brand-600">
          {brand ? (brand.displayName ?? brand.name) : t('app.name')}
        </p>
        <p className="text-ink-muted">
          {brand ? t('login.poweredBy') : isDemoMode() ? demoProfile().tagline : t('app.tagline')}
        </p>
      </div>
      <section className="rounded-card border border-line bg-surface-raised p-5 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {error && known.includes(error) ? (
          <p role="alert" className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {t(`login.errors.${error}`)}
          </p>
        ) : null}
        {children}
      </section>
    </main>
  );
}

export const inputClass =
  'block min-h-tap w-full rounded-xl border border-line bg-surface px-3 text-base focus:outline-2 focus:outline-brand-500';
