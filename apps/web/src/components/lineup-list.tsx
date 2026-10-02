import { getTranslations } from 'next-intl/server';
import type { LineupRow } from '@rswim/domain-attendance';
import { Badge, EmptyState } from '@rswim/ui';
import { ageText } from '@/lib/scheduling';

/** The lineup as the office reads it: each child with their flags, notice and mark (instructors get the tap version). */
export async function LineupList({ rows }: { rows: readonly LineupRow[] }) {
  const t = await getTranslations('attendance.lineup');
  const te = await getTranslations('enums');
  const age = await ageText();
  if (rows.length === 0) return <EmptyState title={t('empty')} />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.studentId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"
          data-testid="lineup-row"
        >
          <div>
            <p className="font-medium">
              {r.firstName} {r.lastName}{' '}
              <span className="text-sm text-ink-muted">{age(r.ageMonths)}</span>
            </p>
            <p className="flex flex-wrap gap-1 text-sm text-ink-muted">
              {r.levelName ? <span>{r.levelName}</span> : null}
              {r.kind !== 'member' ? (
                <Badge tone="warn">{te(`attendanceKind.${r.kind}`)}</Badge>
              ) : null}
              {r.seatStatus === 'frozen' ? <Badge>{te('enrollmentStatus.frozen')}</Badge> : null}
              <LineupFlags flags={r.flags} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {r.notice && r.notice.status !== 'withdrawn' ? (
              <Badge tone="warn">{t('notified')}</Badge>
            ) : null}
            {r.mark ? (
              <Badge tone={r.mark.status === 'absent' ? 'danger' : 'ok'}>
                {te(`attendanceStatus.${r.mark.status}`)}
                {r.mark.minutesLate ? ` (${t('minutes', { n: r.mark.minutesLate })})` : ''}
              </Badge>
            ) : (
              <span className="text-sm text-ink-muted">{t('unmarked')}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Water fear, female instructor only, no photos, medical notes: what the instructor must know before the lesson. */
export async function LineupFlags({ flags }: { flags: LineupRow['flags'] }) {
  const t = await getTranslations('attendance.flags');
  return (
    <>
      {(Object.keys(flags) as (keyof LineupRow['flags'])[])
        .filter((k) => flags[k])
        .map((k) => (
          <Badge key={k} tone={k === 'medical' ? 'danger' : 'neutral'}>
            {t(k)}
          </Badge>
        ))}
    </>
  );
}
