import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TRIAL_OUTCOMES } from '@rswim/contracts';
import { sessionLineup } from '@rswim/domain-attendance';
import { DomainError } from '@rswim/domain-core';
import { trialsInSessions } from '@rswim/domain-enrollment';
import { Card, CardTitle, PageHeader } from '@rswim/ui';
import { ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { enumOptions } from '@/lib/options';
import { ageText } from '@/lib/scheduling';
import { instructorVerdictAction } from '../actions';
import { LineupMarker, type MarkerRow } from '../lineup-marker';

/** The instructor's lesson (brief §6.7): the lineup with flags, one-tap attendance, skill ticks and trial verdicts. */
export default async function InstructorSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async (tx) => {
    try {
      const lineup = await sessionLineup(tx, id);
      return { lineup, trials: await trialsInSessions(tx, [id]) };
    } catch (e) {
      if (e instanceof DomainError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { lineup, trials } = data;
  const t = await getTranslations('attendance.lineup');
  const tt = await getTranslations('enrollment.trials');
  const age = await ageText();
  const { session } = lineup;
  const started = session.startsAt.getTime() <= Date.now();
  const canMark = session.status === 'scheduled' || session.status === 'completed';
  const rows: MarkerRow[] = lineup.rows.map((r) => ({
    studentId: r.studentId,
    name: `${r.firstName} ${r.lastName}`,
    age: age(r.ageMonths),
    kind: r.kind,
    frozen: r.seatStatus === 'frozen',
    notified: r.notice !== null && r.notice.status !== 'withdrawn',
    flags: (Object.keys(r.flags) as (keyof typeof r.flags)[]).filter((k) => r.flags[k]),
    levelId: r.levelId,
    levelName: r.levelName,
    skills: r.skills,
    mark: r.mark
      ? { status: r.mark.status as 'present' | 'late' | 'absent', minutesLate: r.mark.minutesLate }
      : null,
  }));
  const openTrials = trials.filter((tr) => tr.status === 'booked');
  const outcomes = await enumOptions('trialOutcome', TRIAL_OUTCOMES);
  const name = new Map(rows.map((r) => [r.studentId, r.name]));

  return (
    <>
      <PageHeader title={session.groupName} subtitle={sessionWhen(session)} />
      <div className="flex flex-col gap-4" data-testid="instructor-lineup">
        <Link href="/instructor" className="text-brand-700">
          {t('back')}
        </Link>
        <Card>
          <CardTitle>{t('title', { n: rows.length })}</CardTitle>
          {rows.length === 0 ? (
            <p className="text-ink-muted">{t('empty')}</p>
          ) : (
            <LineupMarker sessionId={id} rows={rows} canMark={canMark} />
          )}
        </Card>
        {started && openTrials.length ? (
          <Card>
            <CardTitle>{tt('verdictTitle')}</CardTitle>
            <ul className="flex flex-col gap-3">
              {openTrials.map((tr) => (
                <li key={tr.id} className="rounded-xl border border-line p-3">
                  <p className="mb-2 font-medium">{name.get(tr.studentId) ?? ''}</p>
                  <ActionForm action={instructorVerdictAction} testId="instructor-verdict">
                    <input type="hidden" name="id" value={tr.id} />
                    <input type="hidden" name="sessionId" value={id} />
                    <SelectField
                      name="attended"
                      label={tt('attended')}
                      options={[
                        { value: 'true', label: tt('yes') },
                        { value: 'false', label: tt('no') },
                      ]}
                    />
                    <SelectField
                      name="outcome"
                      label={tt('outcome')}
                      options={outcomes}
                      includeEmpty=""
                    />
                    <Field name="note" label={tt('note')} />
                    <div>
                      <SubmitButton>{tt('saveVerdict')}</SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
