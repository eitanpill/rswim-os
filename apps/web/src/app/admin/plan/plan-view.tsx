import { getLocale, getTranslations } from 'next-intl/server';
import { agorot } from '@rswim/money';
import { myPlanPage } from '@rswim/domain-platform';
import { Badge, Card, CardTitle, Money, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';

const STATUS_TONE = {
  trialing: 'neutral',
  active: 'ok',
  past_due: 'danger',
  suspended: 'danger',
  cancelled: 'warn',
} as const;
const INVOICE_TONE = { open: 'neutral', paid: 'ok', failed: 'danger', void: 'warn' } as const;

/** The school's plan, its usage against the plan's limits, and what the platform billed it. */
export async function PlanView({
  locked = false,
  feature,
}: {
  locked?: boolean;
  feature?: string;
}) {
  const t = await getTranslations('platform.plan');
  const tEnum = await getTranslations('enums');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const page = await withSession((tx) => myPlanPage(tx));
  const planName = (p: { nameHe: string; nameEn: string }) =>
    locale === 'en' ? p.nameEn : p.nameHe;
  const sub = page.subscription;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {locked ? (
        <p
          role="alert"
          data-testid="locked"
          className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-danger"
        >
          {t('locked')}
        </p>
      ) : null}
      {feature ? (
        <p role="status" className="mb-4 rounded-xl bg-warn/20 px-3 py-2">
          {t('featureMissing', {
            feature: tEnum.has(`planFeature.${feature}`)
              ? tEnum(`planFeature.${feature}`)
              : feature,
          })}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="plan-card">
          <CardTitle>{t('current')}</CardTitle>
          {sub && page.plan ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xl font-semibold" data-testid="plan-name">
                  {planName(page.plan)}
                </p>
                <Badge
                  tone={STATUS_TONE[sub.status as keyof typeof STATUS_TONE] ?? 'neutral'}
                  data-testid="plan-status"
                >
                  {tEnum(`subscriptionStatus.${sub.status}`)}
                </Badge>
              </div>
              <p className="text-ink-muted">
                {t('price')} <Money agorot={agorot(page.plan.priceAgorot)} locale={locale} />
              </p>
              {sub.status === 'trialing' && sub.trialEndsOn ? (
                <p>{t('trialEnds', { date: dmy(sub.trialEndsOn) })}</p>
              ) : null}
              {sub.pastDueSince ? (
                <p className="text-danger">{t('pastDueSince', { date: dmy(sub.pastDueSince) })}</p>
              ) : null}
              <p className="text-sm text-ink-muted">
                {sub.mandateId ? t('mandateOk') : t('mandateMissing')}
              </p>
            </div>
          ) : (
            <p className="text-ink-muted">{t('noPlan')}</p>
          )}
        </Card>
        <Card>
          <CardTitle>{t('usage')}</CardTitle>
          <ul className="flex flex-col gap-3">
            {page.usage.map((u) => (
              <li key={u.limit} data-testid={`usage-${u.limit}`}>
                <div className="flex justify-between text-sm">
                  <span>{tEnum(`planLimit.${u.limit}`)}</span>
                  <span className="tabular-nums">
                    {u.max === null
                      ? t('usedUnlimited', { used: u.used })
                      : t('usedOf', { used: u.used, max: u.max })}
                  </span>
                </div>
                {u.pct !== null ? (
                  <div className="mt-1 h-2 rounded-full bg-line" aria-hidden>
                    <div
                      className={
                        u.full ? 'h-2 rounded-full bg-danger' : 'h-2 rounded-full bg-brand-500'
                      }
                      style={{ width: `${u.pct}%` }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mt-6 mb-2 text-lg font-semibold">{t('plans')}</h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {page.plans.map((p) => (
          <li key={p.code}>
            <Card className={p.code === page.plan?.code ? 'border-brand-500' : undefined}>
              <p className="text-lg font-semibold">{planName(p)}</p>
              <p>
                <Money agorot={agorot(p.priceAgorot)} locale={locale} /> {t('perMonth')}
              </p>
              <ul className="mt-2 text-sm text-ink-muted">
                {(['students', 'staff', 'venues'] as const).map((l) => {
                  const max =
                    l === 'students' ? p.maxStudents : l === 'staff' ? p.maxStaff : p.maxVenues;
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
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-muted">{t('changeHint')}</p>

      <h2 className="mt-6 mb-2 text-lg font-semibold">{t('invoices')}</h2>
      {page.invoices.length === 0 ? (
        <p className="text-ink-muted">{t('noInvoices')}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line" data-testid="platform-invoices">
            {page.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span>{dmy(i.period).replace(/^1\./, '')}</span>
                <Money agorot={agorot(i.amountAgorot)} locale={locale} />
                <Badge tone={INVOICE_TONE[i.status as keyof typeof INVOICE_TONE] ?? 'neutral'}>
                  {tEnum(`platformInvoiceStatus.${i.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
