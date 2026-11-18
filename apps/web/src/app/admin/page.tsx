import { getTranslations } from 'next-intl/server';
import {
  Badge,
  buttonVariants,
  Card,
  CardTitle,
  EmptyState,
  Hero,
  Money,
  PageHeader,
  StatTile,
} from '@rswim/ui';
import { agorot } from '@rswim/money';
import Link from 'next/link';
import { openInboxCount } from '@rswim/domain-comms';
import { listAgentActions } from '@rswim/domain-copilot';
import { homeSummary, listInsights, todayIL, type OwnerInsight } from '@rswim/domain-reports';
import { ActionButton } from '@/components/form';
import { TodayLine } from '@/components/today-card';
import { getSession } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { greeting } from '@/lib/greeting';
import { insightDetailLines, insightText } from '@/lib/insights';
import { dismissInsightAction, refreshInsightsAction } from './actions';
import { AgentActionList } from './brain/action-list';

const TONE = { high: 'danger', medium: 'warn', low: 'neutral' } as const;

/**
 * Owner "Command Center" (brief §6.1): what the business brain waits for the owner to approve, what to look at today
 * (the insights feed: advisory only, nothing on it acts on its own), today's lessons, the open inbox, this month's
 * money and growth.
 */
export default async function CommandCenter() {
  const t = await getTranslations('admin.home');
  const ti = await getTranslations('insights');
  const tb = await getTranslations('agent');
  const [inbox, insights, home, waiting] = await withSession(async (tx) => {
    const today = await todayIL(tx);
    return [
      await openInboxCount(tx),
      await listInsights(tx),
      await homeSummary(tx, today),
      // The brain's proposals (owner only: other roles get none through RLS).
      await listAgentActions(tx, { statuses: ['proposed'], limit: 5 }),
    ] as const;
  });
  const text = await insightText();
  const lines = await insightDetailLines();
  const growth = home.seats - home.seatsBefore;
  const hello = await greeting((await getSession())?.displayName);

  return (
    <>
      <PageHeader title={t('title')} subtitle={<TodayLine />} />
      <div className="grid gap-4 md:grid-cols-2" data-testid="home-grid">
        <Hero
          className="md:col-span-2"
          eyebrow={`${hello} 👋`}
          emoji={home.lessons > 0 ? '🌊' : '☀️'}
          title={home.lessons > 0 ? t('heroLessons', { lessons: home.lessons }) : t('todayEmpty')}
          data-testid="home-today"
          actions={
            <>
              {inbox > 0 ? (
                <Link
                  href="/admin/messages"
                  className={buttonVariants({ variant: 'onWater', size: 'sm' })}
                  data-testid="home-inbox"
                >
                  💬 {t('inboxWaiting', { n: inbox })}
                </Link>
              ) : null}
              <Link
                href="/admin/board"
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-white ring-1 ring-white/50 hover:bg-white/10"
              >
                {t('openBoard')}
              </Link>
            </>
          }
        >
          {home.lessons > 0 ? <p>{t('heroChildren', { children: home.children })}</p> : null}
          {inbox > 0 ? null : <p className="text-sm text-white/80">{t('needsYouEmpty')}</p>}
        </Hero>
        <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4">
          <div data-testid="home-money" className="contents">
            <StatTile
              icon="💰"
              label={t('expected')}
              value={<Money agorot={agorot(home.expectedAgorot)} />}
            />
            <StatTile
              icon="✅"
              tone="ok"
              label={t('collected')}
              value={<Money agorot={agorot(home.money.collectedAgorot)} />}
            />
          </div>
          <div data-testid="home-growth" className="contents">
            <StatTile
              icon="🧒"
              label={t('seats')}
              value={home.seats}
              tone={growth < 0 ? 'danger' : 'brand'}
              hint={t('seatsChange', { n: growth, s: growth > 0 ? `+${growth}` : String(growth) })}
            />
            <StatTile icon="🐣" label={t('trials')} value={home.trials} />
          </div>
        </div>
        {waiting.length ? (
          <Card className="md:col-span-2" data-testid="home-brain-waiting">
            <CardTitle
              aside={
                <Link href="/admin/brain" className="text-sm text-brand-700 underline">
                  {tb('waiting.all')}
                </Link>
              }
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>🤖</span>
                {tb('waiting.homeTitle')}
              </span>
            </CardTitle>
            <AgentActionList actions={waiting} />
          </Card>
        ) : null}
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
            <span className="flex items-center gap-2">
              <span aria-hidden>💡</span>
              {ti('title')}
            </span>
          </CardTitle>
          {insights.length === 0 ? (
            <EmptyState icon="🌤️" title={ti('empty')}>
              {ti('emptyHint')}
            </EmptyState>
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
