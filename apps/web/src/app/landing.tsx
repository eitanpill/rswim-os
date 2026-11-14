import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { PRODUCT } from '@rswim/contracts';
import { publicPlans, type PublicPlan } from '@rswim/domain-platform';
import { agorot } from '@rswim/money';
import { Money } from '@rswim/ui';
import { withAnon } from '@/lib/db';

const LIMITS = ['students', 'staff', 'venues'] as const;
const limitOf = (p: PublicPlan, l: (typeof LIMITS)[number]) =>
  l === 'students' ? p.maxStudents : l === 'staff' ? p.maxStaff : p.maxVenues;

const cta =
  'inline-flex min-h-tap items-center justify-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700';

/** What a visitor sees on the platform's address: the promise, the two kinds of business, the prices, sign-up. */
export async function Landing() {
  const t = await getTranslations('landing');
  const tEnum = await getTranslations('enums');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const plans = process.env.DATABASE_URL ? await withAnon((tx) => publicPlans(tx)) : [];
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-12 px-4 py-10"
      data-testid="landing"
    >
      <header className="flex items-center justify-between gap-4">
        <p className="text-2xl font-bold text-brand-600">{PRODUCT.name}</p>
        <Link
          href="/login"
          className="font-medium text-brand-600 underline-offset-4 hover:underline"
        >
          {t('signIn')}
        </Link>
      </header>

      <section className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-bold md:text-4xl">{t('title')}</h1>
        <p className="max-w-2xl text-lg text-ink-muted">{t('subtitle')}</p>
        <Link href="/signup" className={cta} data-testid="landing-signup">
          {t('cta')}
        </Link>
        <p className="text-sm text-ink-muted">{t('ctaHint')}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {(['office', 'whatsapp', 'money'] as const).map((k) => (
          <div key={k} className="rounded-card border border-line bg-surface-raised p-5">
            <h2 className="mb-1 font-semibold">{t(`points.${k}.title`)}</h2>
            <p className="text-sm text-ink-muted">{t(`points.${k}.body`)}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t('verticalsTitle')}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(['swim', 'freediving'] as const).map((v) => (
            <div key={v} className="rounded-card border border-line bg-surface-raised p-5">
              <h3 className="mb-1 font-semibold">{t(`verticals.${v}.title`)}</h3>
              <p className="text-sm text-ink-muted">{t(`verticals.${v}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {plans.length ? (
        <section className="flex flex-col gap-3" data-testid="landing-plans">
          <h2 className="text-xl font-semibold">{t('pricesTitle')}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.code}
                className="flex flex-col gap-2 rounded-card border border-line bg-surface-raised p-5"
                data-testid={`landing-plan-${p.code}`}
              >
                <h3 className="font-semibold">{locale === 'en' ? p.nameEn : p.nameHe}</h3>
                <p className="text-2xl font-bold">
                  <Money agorot={agorot(p.priceAgorot)} locale={locale} />{' '}
                  <span className="text-sm font-normal text-ink-muted">{t('perMonth')}</span>
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {LIMITS.map((l) => {
                    const max = limitOf(p, l);
                    return (
                      <li key={l}>
                        {tEnum(`planLimit.${l}`)}: {max === null ? t('unlimited') : max}
                      </li>
                    );
                  })}
                  {p.features.map((f) => (
                    <li key={f}>✓ {tEnum(`planFeature.${f}`)}</li>
                  ))}
                </ul>
                <p className="mt-auto text-sm text-ink-muted">
                  {t('trial', { days: p.trialDays })}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-line pt-4 text-sm text-ink-muted">
        {t('footer', { email: PRODUCT.supportEmail })}
      </footer>
    </main>
  );
}
