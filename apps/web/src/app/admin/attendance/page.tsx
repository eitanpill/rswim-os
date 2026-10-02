import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { sessionFacts, sessionsBetween } from '@rswim/domain-scheduling';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, todayIL } from '@/lib/options';
import { clockIL } from '@/lib/scheduling';
import { inputClass } from '@/components/form';
import { AttendanceTabs } from './tabs';

/** The office's day: every lesson on a date, each opening its lineup and the absence form. */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: raw } = await searchParams;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIL();
  const t = await getTranslations('attendance.day');
  const label = await enumLabel();
  const { sessions, venues } = await withSession(async (tx) => {
    const ids = (await sessionsBetween(tx, date, date)).map((s) => s.id);
    const [sessions, venues] = await Promise.all([sessionFacts(tx, ids), listVenues(tx)]);
    return { sessions, venues };
  });
  const venueName = new Map(venues.map((v) => [v.id, v.name]));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AttendanceTabs active="day" />
      <div className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <Link href={`?date=${addDays(date, -1)}`} className="min-h-tap px-2 py-3 text-brand-700">
            {t('prev')}
          </Link>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('date')}
            <input type="date" name="date" defaultValue={date} className={inputClass} />
          </label>
          <button type="submit" className="min-h-tap px-2 text-brand-700 underline">
            {t('show')}
          </button>
          <Link href={`?date=${addDays(date, 1)}`} className="min-h-tap px-2 py-3 text-brand-700">
            {t('next')}
          </Link>
        </form>
        <Card>
          <p className="mb-2 font-semibold">{dmy(date)}</p>
          {sessions.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/attendance/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                    data-testid="day-session"
                  >
                    <span className="font-medium">{s.groupName}</span>
                    <span className="flex items-center gap-2 text-sm text-ink-muted">
                      {venueName.get(s.venueId ?? '') ?? ''} ·{' '}
                      <span dir="ltr">
                        {clockIL(s.startsAt)}–{clockIL(s.endsAt)}
                      </span>
                      {s.status !== 'scheduled' ? (
                        <Badge tone={s.status === 'completed' ? 'ok' : 'warn'}>
                          {label('sessionStatus', s.status)}
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
