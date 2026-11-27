import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { coachWeekView, isAgentOwner, reviewLine } from '@rswim/domain-copilot';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

/**
 * The weekly coach (docs/AI-BRAIN.md, stage 8): this week's Sunday note as the owner's WhatsApp gets it, and the weeks
 * before with how their advice went. Only the owner sees it; rules only, no model.
 */
export default async function BrainCoachPage() {
  const t = await getTranslations('agent.coach');
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const view = await withSession(async (tx) =>
    (await isAgentOwner(tx)) ? coachWeekView(tx, locale) : null,
  );
  const header = (
    <PageHeader
      icon="🧭"
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <Link href="/admin/brain" className="text-sm text-brand-ink underline">
          {t('back')}
        </Link>
      }
    />
  );
  if (!view) {
    return (
      <>
        {header}
        <Card data-testid="brain-owner-only">
          <p className="text-sm">{t('ownerOnly')}</p>
        </Card>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card data-testid="coach-this-week">
          <CardTitle>{t('thisWeek', { date: dm(view.facts.weekOf) })}</CardTitle>
          {view.text ? (
            <>
              <p className="whitespace-pre-line text-sm leading-6" data-testid="coach-note">
                {view.text}
              </p>
              <p className="mt-3 text-xs text-ink-muted">{t('howToReply')}</p>
            </>
          ) : (
            <EmptyState icon="🌤️" title={t('nothing')} />
          )}
        </Card>
        <Card data-testid="coach-history">
          <CardTitle>{t('history')}</CardTitle>
          {view.history.length === 0 ? (
            <EmptyState icon="🗓️" title={t('noHistory')} />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {view.history.map((w) => (
                <li key={w.weekOf} className="flex flex-col gap-1 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t('week', { date: dm(w.weekOf) })}</span>
                    <Badge tone={w.sent ? 'ok' : 'neutral'}>{t(w.sent ? 'sent' : 'notSent')}</Badge>
                    <span className="text-xs text-ink-muted">
                      {t('priorities', { count: w.priorities.length })}
                    </span>
                  </span>
                  {w.review && w.review.length > 0 ? (
                    <span className="flex flex-col text-sm">
                      <span className="text-xs text-ink-muted">{t('checkedThen')}</span>
                      {w.review.map((r, i) => (
                        <span key={i}>{reviewLine(r, locale)}</span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
