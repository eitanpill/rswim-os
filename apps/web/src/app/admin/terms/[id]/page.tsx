import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { hebrewDate } from '@rswim/calendar';
import { getTerm, type SkippedRow } from '@rswim/domain-scheduling';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { generateSessionsAction, updateTermAction } from '../actions';
import { TermForm } from '../term-form';

/** Dates outside a group's own start and end are counted, not listed: they are expected, not news. */
const OUTSIDE = ['before_group_start', 'after_group_end'];
const outsideGroupDates = (s: SkippedRow) => s.reasons.every((r) => OUTSIDE.includes(r));

/** Report rows by date: which groups skipped that day and why (explainability, brief §6.4). */
function byDate(skipped: readonly SkippedRow[]) {
  const days = new Map<string, SkippedRow[]>();
  for (const s of skipped.filter((x) => !outsideGroupDates(x))) {
    days.set(s.date, [...(days.get(s.date) ?? []), s]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default async function TermPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await withSession((tx) => getTerm(tx, id));
  if (!detail) notFound();
  const t = await getTranslations('scheduling.terms');
  const label = await enumLabel();
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  const { term, runs, sessionCount } = detail;
  const [last] = runs;

  return (
    <>
      <PageHeader
        title={term.name}
        subtitle={`${dmy(term.startsOn)} – ${dmy(term.endsOn)} · ${t('sessionCount', { n: sessionCount })}`}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('generate')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('generateHint')}</p>
          <ActionForm action={generateSessionsAction.bind(null, term.id)} testId="generate-form">
            <div>
              <SubmitButton>{t('generateNow')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card data-testid="generation-report">
          <CardTitle>{t('report')}</CardTitle>
          {!last ? (
            <EmptyState title={t('noRuns')} />
          ) : (
            <>
              <p className="mb-3" data-testid="report-summary">
                {t('reportSummary', {
                  created: last.createdCount,
                  existing: last.existingCount,
                  skipped: last.skipped.length,
                })}
              </p>
              {last.skipped.some(outsideGroupDates) ? (
                <p className="mb-3 text-sm text-ink-muted">
                  {t('outsideGroupDates', { n: last.skipped.filter(outsideGroupDates).length })}
                </p>
              ) : null}
              {last.skipped.length === 0 ? null : (
                <ol className="flex flex-col gap-2">
                  {byDate(last.skipped).map(([date, rows]) => {
                    const reasons = [...new Set(rows.flatMap((r) => r.reasons))];
                    const details = [...new Set(rows.flatMap((r) => r.details))];
                    return (
                      <li
                        key={date}
                        className="rounded-xl border border-line p-3"
                        data-testid="skipped-day"
                      >
                        <p className="font-medium">
                          {dmy(date)} · {hebrewDate(date, locale)}
                        </p>
                        <p className="text-sm">
                          {reasons.map((r) => label('skipReason', r)).join(', ')}
                          {details.length ? ` (${details.join(', ')})` : ''}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {rows.map((r) => r.groupName).join(', ')}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </Card>

        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer text-lg font-semibold">
              {t('details')}
            </summary>
            <div className="mt-3">
              <TermForm action={updateTermAction.bind(null, term.id)} term={term} />
            </div>
          </details>
        </Card>
      </div>
    </>
  );
}
