import { getTranslations } from 'next-intl/server';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { agorot } from '@rswim/money';
import Link from 'next/link';
import { openInboxCount } from '@rswim/domain-comms';
import { homeSummary, listInsights, todayIL, type OwnerInsight } from '@rswim/domain-reports';
import { ActionButton } from '@/components/form';
import { TodayLine } from '@/components/today-card';
import { withSession } from '@/lib/db';
import { insightDetailLines, insightText } from '@/lib/insights';
import { dismissInsightAction, refreshInsightsAction } from './actions';

const TONE = { high: 'danger', medium: 'warn', low: 'neutral' } as const;

/**
 * Owner "Command Center" (brief §6.1): what to look at today (the insights feed: advisory only, nothing on it acts on
 * its own), today's lessons, the open inbox, this month's money and growth.
 */
export default async function CommandCenter() {
  const t = await getTranslations('admin.home');
  const ti = await getTranslations('insights');
  const [inbox, insights, home] = await withSession(async (tx) => {
    const today = await todayIL(tx);
    return [
      await openInboxCount(tx),
      await listInsights(tx),
      await homeSummary(tx, today),
    ] as const;
  });
  const text = await insightText();
  const lines = await insightDetailLines();
  const growth = home.seats - home.seatsBefore;

  return (
    <>
      <PageHeader title={t('title')} subtitle={<TodayLine />} />
      <div className="grid gap-4 md:grid-cols-2" data-testid="home-grid">
        <Card className="md:col-span-2" data-testid="insights">
          <CardTitle
            aside={
              <ActionButton
                action={refreshInsightsAction}
                variant="secondary"
                data-testid="insights-refresh"
              >
                {ti('refresh')}
              </ActionButton>
            }
          >
            {ti('title')}
          </CardTitle>
          {insights.length === 0 ? (
            <EmptyState title={ti('empty')}>{ti('emptyHint')}</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {insights.map((i) => (
                <InsightRow
                  key={i.id}
                  insight={i}
                  title={text(`insights.kinds.${i.kind}.title`, i.params)}
                  action={text(`insights.kinds.${i.kind}.action`, i.params)}
                  lines={lines(i.kind, i.detail)}
                  labels={{
                    severity: ti(`severity.${i.severity}`),
                    open: ti('open'),
                    dismiss: ti('dismiss'),
                    why: ti('why.title'),
                    next: ti('next'),
                    ai: ti('ai'),
                  }}
                />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-muted">{ti('advisory')}</p>
        </Card>
        <Card>
          <CardTitle>{t('today')}</CardTitle>
          {home.lessons > 0 ? (
            <p className="text-lg" data-testid="home-today">
              {t('todayLessons', { lessons: home.lessons, children: home.children })}
            </p>
          ) : (
            <EmptyState title={t('todayEmpty')} />
          )}
        </Card>
        <Card>
          <CardTitle>{t('needsYou')}</CardTitle>
          {inbox > 0 ? (
            <Link
              href="/admin/messages"
              className="font-medium text-brand-700 underline"
              data-testid="home-inbox"
            >
              {t('inboxWaiting', { n: inbox })}
            </Link>
          ) : (
            <EmptyState title={t('needsYouEmpty')} />
          )}
        </Card>
        <Card>
          <CardTitle>{t('money')}</CardTitle>
          <dl className="grid grid-cols-2 gap-3" data-testid="home-money">
            <div>
              <dt className="text-sm text-ink-muted">{t('expected')}</dt>
              <dd className="text-xl font-semibold">
                <Money agorot={agorot(home.expectedAgorot)} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('collected')}</dt>
              <dd className="text-xl font-semibold">
                <Money agorot={agorot(home.money.collectedAgorot)} />
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardTitle>{t('growth')}</CardTitle>
          <dl className="grid grid-cols-2 gap-3" data-testid="home-growth">
            <div>
              <dt className="text-sm text-ink-muted">{t('seats')}</dt>
              <dd className="text-xl font-semibold">
                {home.seats}{' '}
                <span className={growth < 0 ? 'text-sm text-danger' : 'text-sm text-ok'}>
                  {t('seatsChange', { n: growth, s: growth > 0 ? `+${growth}` : String(growth) })}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('trials')}</dt>
              <dd className="text-xl font-semibold">{home.trials}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}

function InsightRow({
  insight: i,
  title,
  action,
  lines,
  labels,
}: {
  insight: OwnerInsight;
  title: string;
  action: string;
  lines: string[];
  labels: Record<'severity' | 'open' | 'dismiss' | 'why' | 'next' | 'ai', string>;
}) {
  return (
    <li className="flex flex-col gap-1.5 py-3" data-testid="insight" data-kind={i.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[i.severity]}>{labels.severity}</Badge>
        <span className="font-medium">{title}</span>
      </div>
      {i.note ? (
        <p className="text-sm" data-testid="insight-note">
          {i.note.explanation} <span className="text-xs text-ink-muted">({labels.ai})</span>
        </p>
      ) : null}
      <p className="text-sm">
        <span className="font-medium">{labels.next}: </span>
        {i.note?.recommendation ?? action}
      </p>
      {lines.length ? (
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer">{labels.why}</summary>
          <ul className="ms-4 mt-1 list-disc">
            {lines.map((l, n) => (
              <li key={n}>{l}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {i.href ? (
          <Link href={i.href} className="text-sm font-medium text-brand-700 underline">
            {labels.open}
          </Link>
        ) : null}
        <ActionButton
          action={dismissInsightAction}
          fields={{ id: i.id }}
          variant="ghost"
          data-testid="insight-dismiss"
        >
          {labels.dismiss}
        </ActionButton>
      </div>
    </li>
  );
}
