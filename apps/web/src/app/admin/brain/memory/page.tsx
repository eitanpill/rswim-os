import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  isAgentOwner,
  listMemories,
  listSnapshots,
  shiftPeriod,
  type MemoryRow,
} from '@rswim/domain-copilot';
import { absencePct } from '@rswim/domain-reports/policies';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, SubmitButton, TextareaField } from '@/components/form';
import { withSession } from '@/lib/db';
import { ReportTable } from '../../reports/shared';
import { archiveMemoryAction, rememberAction } from '../actions';

const day = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});
const shekels = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('he-IL')}`;

/**
 * What the brain remembers (docs/AI-BRAIN.md, stage 5): the owner's notes, what happened in the business, and the
 * months side by side with the same month a year before. Only the owner sees it; she adds a note or archives one that
 * is wrong.
 */
export default async function BrainMemoryPage() {
  const t = await getTranslations('agent.memory');
  const data = await withSession(async (tx) =>
    (await isAgentOwner(tx))
      ? {
          notes: await listMemories(tx, { kind: 'note', limit: 100 }),
          events: await listMemories(tx, { kind: 'event', limit: 50 }),
          months: await listSnapshots(tx, 25),
        }
      : null,
  );
  const header = (
    <PageHeader
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <Link href="/admin/brain" className="text-sm text-brand-700 underline">
          {t('back')}
        </Link>
      }
    />
  );
  if (!data) {
    return (
      <>
        {header}
        <Card data-testid="brain-owner-only">
          <p className="text-sm">{t('ownerOnly')}</p>
        </Card>
      </>
    );
  }
  const { notes, events, months } = data;
  const byPeriod = new Map(months.map((m) => [m.period, m.facts]));

  const eventText = (m: MemoryRow) => {
    const s = m.summary ?? { code: '', params: {} };
    const kind = s.code.split('.').pop() as string;
    const p = { ...s.params };
    if (kind === 'closure' && !p.venue) p.venue = t('allVenues');
    if (kind === 'substitute') p.outcome = t(`outcome.${String(p.outcome)}` as 'outcome.filled');
    return t(`events.${kind}` as 'events.closure', p);
  };

  const MemoryList = ({ rows, testId }: { rows: MemoryRow[]; testId: string }) => (
    <ul className="flex flex-col gap-2" data-testid={testId}>
      {rows.map((m) => (
        <li
          key={m.id}
          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line p-3"
          data-testid="memory-row"
          data-kind={m.kind}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm">{m.kind === 'note' ? m.body : eventText(m)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
              <span>{day.format(new Date(`${m.happenedOn}T00:00:00Z`))}</span>
              {m.subjectLabel ? (
                <Badge tone="neutral">
                  {t(`subject.${m.subjectType}`)}: {m.subjectLabel}
                </Badge>
              ) : null}
              <span>· {t(`source.${m.source}`)}</span>
            </p>
          </div>
          <ActionButton
            action={archiveMemoryAction}
            fields={{ id: m.id }}
            variant="ghost"
            confirm={t('archiveConfirm')}
            data-testid="memory-archive"
          >
            {t('archive')}
          </ActionButton>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card data-testid="memory-add">
          <CardTitle>{t('add.title')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('add.hint')}</p>
          <ActionForm action={rememberAction} testId="memory-add-form" resetOnSuccess>
            <TextareaField
              name="body"
              label={t('add.body')}
              placeholder={t('add.placeholder')}
              required
            />
            <div>
              <SubmitButton data-testid="memory-add-save">{t('add.save')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('notes.title', { n: notes.length })}</CardTitle>
          {notes.length ? (
            <MemoryList rows={notes} testId="memory-notes" />
          ) : (
            <EmptyState title={t('notes.empty')} />
          )}
        </Card>

        <Card>
          <CardTitle>{t('months.title')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('months.hint')}</p>
          {months.length ? (
            <ReportTable
              testId="memory-months"
              head={[
                t('months.period'),
                t('months.places'),
                t('months.lastYear'),
                t('months.joined'),
                t('months.left'),
                t('months.lessons'),
                t('months.cancelled'),
                t('months.absences'),
                t('months.collected'),
              ]}
              rows={months.slice(0, 13).map((m) => {
                const year = byPeriod.get(shiftPeriod(m.period, -12));
                const pct = absencePct(m.facts);
                return {
                  key: m.period,
                  cells: [
                    <span key="p" className="whitespace-nowrap">
                      {m.period}
                      {m.final ? null : (
                        <span className="text-xs text-ink-muted"> · {t('months.running')}</span>
                      )}
                    </span>,
                    m.facts.placesAtEnd,
                    year ? year.placesAtEnd : '—',
                    m.facts.newPlaces,
                    m.facts.endedPlaces,
                    m.facts.lessonsHeld,
                    m.facts.lessonsCancelled,
                    pct === null ? '—' : `${pct}%`,
                    shekels(m.facts.collectedAgorot),
                  ],
                };
              })}
            />
          ) : (
            <EmptyState title={t('months.empty')} />
          )}
        </Card>

        <Card>
          <CardTitle>{t('events.title')}</CardTitle>
          {events.length ? (
            <MemoryList rows={events} testId="memory-events" />
          ) : (
            <EmptyState title={t('events.empty')} />
          )}
        </Card>
      </div>
    </>
  );
}
