import { getLocale, getTranslations } from 'next-intl/server';
import { agorot } from '@rswim/money';
import { listPlans, listSchools } from '@rswim/domain-platform';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSignedIn } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { requestBillingAction, updateSchoolAction } from './actions';

const STATUS_TONE = {
  trialing: 'neutral',
  active: 'ok',
  past_due: 'danger',
  suspended: 'danger',
  cancelled: 'warn',
} as const;

/** The platform console: every school, its plan, usage and billing, and the monthly billing run. */
export default async function PlatformHome() {
  const t = await getTranslations('platform.console');
  const tEnum = await getTranslations('enums');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const { schools, plans } = await withSignedIn(
    async (tx) => ({ schools: await listSchools(tx), plans: await listPlans(tx) }),
    { platform: true },
  );
  const planOptions = plans.map((p) => ({
    value: p.code,
    label: locale === 'en' ? p.nameEn : p.nameHe,
  }));
  const planName = (code: string | null) => planOptions.find((p) => p.value === code)?.label ?? '—';
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { count: schools.length })} />
      <Card className="mb-4">
        <CardTitle>{t('billing')}</CardTitle>
        <ActionForm
          action={requestBillingAction}
          className="md:flex-row md:items-end"
          testId="billing-run"
        >
          <Field
            name="month"
            type="month"
            label={t('month')}
            defaultValue={todayIL().slice(0, 7)}
            dir="ltr"
          />
          <div>
            <SubmitButton>{t('runBilling')}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      {schools.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {schools.map((s) => (
            <li key={s.organizationId}>
              <Card data-testid={`school-${s.slug}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{s.name}</h2>
                    <p className="text-sm text-ink-muted" dir="ltr">
                      {s.slug}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{planName(s.planCode)}</Badge>
                    {s.status ? (
                      <Badge tone={STATUS_TONE[s.status]} data-testid="school-status">
                        {tEnum(`subscriptionStatus.${s.status}`)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-sm" data-testid="school-usage">
                  {t('usage', { students: s.students, staff: s.staff, venues: s.venues })}
                </p>
                <p className="text-sm text-ink-muted">
                  {s.status === 'trialing' && s.trialEndsOn
                    ? `${t('trialEnds', { date: dmy(s.trialEndsOn) })} · `
                    : ''}
                  {s.lastPeriod ? (
                    <span data-testid="school-last-invoice">
                      {t('lastInvoice', {
                        month: dmy(s.lastPeriod).replace(/^1\./, ''),
                        status: tEnum(`platformInvoiceStatus.${s.lastStatus ?? 'open'}`),
                      })}{' '}
                      {s.lastAmount !== null ? (
                        <Money agorot={agorot(s.lastAmount)} locale={locale} />
                      ) : null}
                    </span>
                  ) : (
                    t('noInvoice')
                  )}
                </p>
                {s.status ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-medium text-brand-700">
                      {t('manage')}
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        {s.status === 'trialing' ? (
                          <ActionButton
                            action={updateSchoolAction}
                            fields={{ organizationId: s.organizationId, action: 'endTrial' }}
                            variant="secondary"
                          >
                            {t('endTrial')}
                          </ActionButton>
                        ) : null}
                        {s.status === 'suspended' ? (
                          <ActionButton
                            action={updateSchoolAction}
                            fields={{ organizationId: s.organizationId, action: 'reactivate' }}
                            variant="secondary"
                          >
                            {t('reactivate')}
                          </ActionButton>
                        ) : (
                          <ActionButton
                            action={updateSchoolAction}
                            fields={{ organizationId: s.organizationId, action: 'suspend' }}
                            variant="ghost"
                            confirm={t('suspendConfirm')}
                          >
                            {t('suspend')}
                          </ActionButton>
                        )}
                      </div>
                      <ActionForm action={updateSchoolAction} className="md:flex-row md:items-end">
                        <input type="hidden" name="organizationId" value={s.organizationId} />
                        <input type="hidden" name="action" value="plan" />
                        <SelectField
                          name="planCode"
                          label={t('plan')}
                          options={planOptions}
                          defaultValue={s.planCode ?? undefined}
                        />
                        <div>
                          <SubmitButton variant="secondary">{t('changePlan')}</SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm
                        action={updateSchoolAction}
                        className="md:flex-row md:items-end"
                        testId="mandate-form"
                      >
                        <input type="hidden" name="organizationId" value={s.organizationId} />
                        <input type="hidden" name="action" value="mandate" />
                        <Field
                          name="mandateId"
                          label={t('mandate')}
                          hint={t('mandateHint')}
                          defaultValue={s.mandateId ?? ''}
                          dir="ltr"
                        />
                        <div>
                          <SubmitButton variant="secondary">{t('saveMandate')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
