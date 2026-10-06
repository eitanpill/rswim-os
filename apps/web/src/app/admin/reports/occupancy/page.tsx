import { getTranslations } from 'next-intl/server';
import { digestRulesFrom, heatLevel, occupancy, type HeatLevel } from '@rswim/domain-reports';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { Card, cn, EmptyState, PageHeader } from '@rswim/ui';
import { inputClass } from '@/components/form';
import { withSession } from '@/lib/db';
import { todayIL } from '@/lib/options';
import { pct, ReportTable, ReportTabs } from '../shared';

const LEVEL: Record<HeatLevel, string> = {
  none: 'bg-surface text-ink-muted',
  low: 'bg-warn/20',
  mid: 'bg-brand-50 dark:bg-surface',
  high: 'bg-ok/20',
  full: 'bg-ok/40 font-semibold',
};

/** Occupancy heatmap (brief §6.14): seats held out of capacity, venue × weekday × hour, on a date. */
export default async function OccupancyReport({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const t = await getTranslations('reports');
  const tw = await getTranslations('common.weekday');
  const q = await searchParams;
  const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayIL();
  const { data, rules } = await withSession(async (tx) => ({
    data: await occupancy(tx, date),
    rules: digestRulesFrom((await resolvePolicyFor(tx, { date })).rules),
  }));
  const marks = { highPct: rules.highOccupancyPct, lowPct: rules.lowOccupancyPct };

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('occupancy.subtitle')} />
      <ReportTabs active="occupancy" />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('occupancy.date')}
          <input type="date" name="date" defaultValue={date} className={inputClass} />
        </label>
        <button type="submit" className="min-h-tap px-2 text-brand-700 underline">
          {t('show')}
        </button>
        <a
          href={`/api/reports/occupancy?date=${date}`}
          className="min-h-tap px-2 py-3 text-sm text-brand-700 underline"
          data-testid="report-csv"
          download
        >
          {t('csv')}
        </a>
      </form>
      <div className="flex flex-col gap-4">
        {data.venues.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}
        {data.venues.map((v) => {
          const cells = data.cells.filter((c) => c.venueId === v.id);
          const days = [...new Set(cells.map((c) => c.weekday))].sort();
          const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
          return (
            <Card key={v.id} data-testid="heatmap" data-venue={v.name}>
              <h2 className="mb-2 text-lg font-semibold">{v.name}</h2>
              <div className="overflow-x-auto">
                <table className="border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th />
                      {hours.map((h) => (
                        <th key={h} className="px-2 font-normal text-ink-muted" dir="ltr">
                          {String(h).padStart(2, '0')}:00
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d}>
                        <th className="pe-2 text-start font-medium">{tw(String(d))}</th>
                        {hours.map((h) => {
                          const c = cells.find((x) => x.weekday === d && x.hour === h);
                          return (
                            <td
                              key={h}
                              data-testid={c ? 'heat-cell' : undefined}
                              className={cn(
                                'min-w-16 rounded-lg px-2 py-2 text-center',
                                c ? LEVEL[heatLevel(c.pct, marks)] : '',
                              )}
                              title={
                                c
                                  ? t('occupancy.cell', {
                                      held: c.held,
                                      capacity: c.capacity,
                                      groups: c.groups,
                                    })
                                  : undefined
                              }
                            >
                              {c ? (
                                <>
                                  <span className="block">{pct(c.pct)}</span>
                                  <span className="block text-xs text-ink-muted" dir="ltr">
                                    {c.held}/{c.capacity}
                                  </span>
                                </>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="mt-2">
                <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                  {t('occupancy.groups')}
                </summary>
                <ReportTable
                  head={[t('group'), t('occupancy.slot'), t('occupancy.seats')]}
                  rows={data.groups
                    .filter((g) => g.venueId === v.id)
                    .map((g) => ({
                      key: g.id,
                      cells: [
                        g.name,
                        `${tw(String(g.weekday))} ${g.startsAt}`,
                        `${g.held}/${g.capacity}`,
                      ],
                    }))}
                />
              </details>
            </Card>
          );
        })}
        <p className="text-xs text-ink-muted">
          {t('occupancy.legend', { high: rules.highOccupancyPct, low: rules.lowOccupancyPct })}
        </p>
      </div>
    </>
  );
}
