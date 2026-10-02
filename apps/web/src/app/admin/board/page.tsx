import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { boardData } from '@rswim/domain-scheduling';
import { getVenue, listVenues } from '@rswim/domain-venues';
import { Card, EmptyState, PageHeader, cn } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { todayIL } from '@/lib/options';
import { Board } from './board';

type Search = { venue?: string; date?: string };

/** Group Board for one venue on a date: the seats held that day, and moves that take effect from it. */
export default async function BoardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const t = await getTranslations('scheduling.board');
  const onDate = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayIL();
  const data = await withSession(async (tx) => {
    const venues = (await listVenues(tx)).filter((v) => v.status === 'active');
    const venue = venues.find((v) => v.id === q.venue) ?? venues[0];
    if (!venue) return { venues, venue: null, groups: [], lanes: {} };
    const [board, detail] = await Promise.all([
      boardData(tx, venue.id, onDate),
      getVenue(tx, venue.id),
    ]);
    const lanes = Object.fromEntries(
      (detail?.pools ?? []).flatMap((p) => p.lanes.map((l) => [l.id, l.label] as const)),
    );
    return { venues, venue, groups: board.groups, lanes };
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href="/admin/groups" className="text-brand-700 underline">
            {t('allGroups')}
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <nav aria-label={t('venues')} className="flex flex-wrap gap-2">
          {data.venues.map((v) => (
            <Link
              key={v.id}
              href={`/admin/board?venue=${v.id}&date=${onDate}`}
              aria-current={v.id === data.venue?.id ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-tap items-center rounded-xl border border-line px-3',
                v.id === data.venue?.id &&
                  'border-brand-500 bg-brand-50 font-semibold dark:bg-surface',
              )}
            >
              {v.name}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2">
          {data.venue ? <input type="hidden" name="venue" value={data.venue.id} /> : null}
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('onDate')}
            <input
              type="date"
              name="date"
              defaultValue={onDate}
              className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
            />
          </label>
          <button type="submit" className="min-h-tap rounded-xl border border-line px-4">
            {t('show')}
          </button>
        </form>
        <p className="text-sm text-ink-muted">{t('hint')}</p>
      </div>
      {data.groups.length === 0 ? (
        <Card>
          <EmptyState title={t('noGroups')}>
            <Link href="/admin/groups" className="text-brand-700 underline">
              {t('allGroups')}
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <Board groups={data.groups} onDate={onDate} laneLabels={data.lanes} />
      )}
    </>
  );
}
