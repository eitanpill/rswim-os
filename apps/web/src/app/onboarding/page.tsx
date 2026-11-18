import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { agorot } from '@rswim/money';
import { listPlans, trialPreview } from '@rswim/domain-platform';
import { Card, Money } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { AquaHero, SignupSteps } from '@/components/aqua-hero';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { TrialPromise } from '@/components/trial-promise';
import { getSession } from '@/lib/auth/session';
import { withSignedIn } from '@/lib/db';
import { todayIL } from '@/lib/options';
import { createSchoolAction } from './actions';

const VERTICAL_ICON = { swim: '🏊', freediving: '🤿' } as const;

/** Sign-up: a signed-in user with no school opens one on a plan, with a free trial. */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('platform.signup');
  const tEnum = await getTranslations('enums');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const plans = await withSignedIn((tx) => listPlans(tx));
  // Every plan has the same trial today; the promise shows the first plan's, with each plan's price on its card.
  const first = plans[0];
  const preview = first ? trialPreview(todayIL(), first.trialDays, first.trialReminderDays) : null;
  // The middle plan of three is the one most schools pick.
  const popular = plans.length >= 3 ? plans[1]?.code : undefined;
  return (
    <AppShell session={session} surface="onboarding" nav={[]}>
      <AquaHero icon="🏊" title={t('heroTitle')} subtitle={t('heroSubtitle')}>
        <SignupSteps current={2} labels={t.raw('steps') as [string, string, string]} />
      </AquaHero>
      <p className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm dark:bg-surface">
        {t('parentHint')}
      </p>
      <Card className="aqua-in">
        <ActionForm action={createSchoolAction} testId="create-school">
          <Field name="name" label={t('name')} placeholder={t('namePlaceholder')} />
          <Field name="slug" label={t('slug')} hint={t('slugHint')} dir="ltr" placeholder="galim" />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('vertical')}</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {(['swim', 'freediving'] as const).map((v, i) => (
                <label
                  key={v}
                  className="aqua-pick relative flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-raised p-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-surface"
                  data-testid={`vertical-${v}`}
                >
                  <input
                    type="radio"
                    name="vertical"
                    value={v}
                    defaultChecked={i === 0}
                    className="sr-only"
                  />
                  <span className="text-4xl leading-none" aria-hidden="true">
                    {VERTICAL_ICON[v]}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-semibold">{t(`verticals.${v}.title`)}</span>
                    <span className="text-sm text-ink-muted">{t(`verticals.${v}.body`)}</span>
                  </span>
                  <span
                    className="aqua-check absolute end-3 top-3 grid size-6 place-items-center rounded-full bg-brand-600 text-sm text-white"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('plan')}</legend>
            <div className="grid gap-3 md:grid-cols-3">
              {plans.map((p, i) => (
                <label
                  key={p.code}
                  className="aqua-pick aqua-in relative flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-surface-raised p-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-surface"
                  style={{ animationDelay: `${0.05 + i * 0.08}s` }}
                  data-testid={`plan-${p.code}`}
                >
                  {p.code === popular ? (
                    <span className="aqua-shine absolute -top-3 start-3 rounded-full px-2 py-0.5 text-xs font-bold text-ink">
                      {t('popular')}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="plan"
                      value={p.code}
                      defaultChecked={i === 0}
                      className="size-5 accent-brand-600"
                    />
                    <span className="font-semibold">{locale === 'en' ? p.nameEn : p.nameHe}</span>
                  </span>
                  <span className="text-2xl font-bold text-brand-700 dark:text-brand-500">
                    <Money agorot={agorot(p.priceAgorot)} locale={locale} />{' '}
                    <span className="text-sm font-normal text-ink-muted">{t('perMonth')}</span>
                  </span>
                  <span className="text-sm text-ink-muted">
                    {(['students', 'staff', 'venues'] as const)
                      .map((l) => {
                        const max =
                          l === 'students'
                            ? p.maxStudents
                            : l === 'staff'
                              ? p.maxStaff
                              : p.maxVenues;
                        return `${tEnum(`planLimit.${l}`)}: ${max === null ? t('unlimited') : max}`;
                      })
                      .join(' · ')}
                  </span>
                  <span className="text-sm font-medium text-ok">
                    🎁 {t('trial', { days: p.trialDays })}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {first && preview ? (
            <TrialPromise
              days={first.trialDays}
              timeline={preview}
              priceAgorot={null}
              locale={locale}
            />
          ) : null}
          <div>
            <SubmitButton>{t('submit')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </AppShell>
  );
}
