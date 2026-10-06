import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { agorot } from '@rswim/money';
import { listPlans } from '@rswim/domain-platform';
import { Card, Money, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { withSignedIn } from '@/lib/db';
import { createSchoolAction } from './actions';

/** Sign-up: a signed-in user with no school opens one on a plan, with a free trial. */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('platform.signup');
  const tEnum = await getTranslations('enums');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const plans = await withSignedIn((tx) => listPlans(tx));
  return (
    <AppShell session={session} surface="onboarding" nav={[]}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <p className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm dark:bg-surface">
        {t('parentHint')}
      </p>
      <Card>
        <ActionForm action={createSchoolAction} testId="create-school">
          <Field name="name" label={t('name')} placeholder={t('namePlaceholder')} />
          <Field name="slug" label={t('slug')} hint={t('slugHint')} dir="ltr" placeholder="galim" />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('plan')}</legend>
            <div className="grid gap-2 md:grid-cols-3">
              {plans.map((p, i) => (
                <label
                  key={p.code}
                  className="flex cursor-pointer flex-col gap-1 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-surface"
                  data-testid={`plan-${p.code}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="plan"
                      value={p.code}
                      defaultChecked={i === 0}
                      className="size-5"
                    />
                    <span className="font-semibold">{locale === 'en' ? p.nameEn : p.nameHe}</span>
                  </span>
                  <span>
                    <Money agorot={agorot(p.priceAgorot)} locale={locale} /> {t('perMonth')}
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
                  <span className="text-sm text-ink-muted">
                    {t('trial', { days: p.trialDays })}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <SubmitButton>{t('submit')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </AppShell>
  );
}
