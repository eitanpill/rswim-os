import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { cn } from '@rswim/ui';
import { inputClass } from '@/components/form';
import { periodLabel } from '@/lib/billing';
import { todayIL } from '@/lib/options';

const TABS = {
  revenue: '/admin/reports',
  venues: '/admin/reports/venues',
  occupancy: '/admin/reports/occupancy',
  churn: '/admin/reports/churn',
  funnel: '/admin/reports/funnel',
  instructors: '/admin/reports/instructors',
  digest: '/admin/reports/digest',
} as const;
export type ReportTab = keyof typeof TABS;

/** One row of links between the report screens. */
export async function ReportTabs({ active }: { active: ReportTab }) {
  const t = await getTranslations('reports.tabs');
  return (
    <nav aria-label={t('label')} className="mb-4 flex gap-1 overflow-x-auto">
      {(Object.keys(TABS) as ReportTab[]).map((k) => (
        <Link
          key={k}
          href={TABS[k]}
          aria-current={k === active ? 'page' : undefined}
          className={cn(
            'min-h-tap shrink-0 rounded-full border border-line px-4 py-2.5 text-sm',
            k === active && 'border-brand-500 bg-brand-50 font-semibold dark:bg-surface',
          )}
        >
          {t(k)}
        </Link>
      ))}
    </nav>
  );
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const shift = (period: string, months: number) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

/** The months a report covers: from the query (?from=YYYY-MM&to=YYYY-MM), else the last six months and the next. */
export function rangeFrom(q: { from?: string; to?: string }): { from: string; to: string } {
  const now = todayIL().slice(0, 7);
  const from = q.from && PERIOD.test(q.from) ? q.from : shift(now, -5);
  const to = q.to && PERIOD.test(q.to) ? q.to : shift(now, 1);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The month range picker and the CSV link of a report. */
export async function RangeBar({
  range,
  csv,
  children,
}: {
  range: { from: string; to: string };
  /** The export's report key, when the screen has one. */
  csv?: string;
  children?: ReactNode;
}) {
  const t = await getTranslations('reports');
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2" data-testid="report-range">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('from')}
        <input type="month" name="from" defaultValue={range.from} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('to')}
        <input type="month" name="to" defaultValue={range.to} className={inputClass} />
      </label>
      {children}
      <button type="submit" className="min-h-tap px-2 text-brand-700 underline">
        {t('show')}
      </button>
      {csv ? (
        <a
          href={`/api/reports/${csv}?from=${range.from}&to=${range.to}`}
          className="min-h-tap px-2 py-3 text-sm text-brand-700 underline"
          data-testid="report-csv"
          download
        >
          {t('csv')}
        </a>
      ) : null}
      <p className="w-full text-xs text-ink-muted">
        {t('range', { from: periodLabel(range.from), to: periodLabel(range.to) })}
      </p>
    </form>
  );
}

/** A plain report table: a header row and body rows, scrolling sideways on a phone. */
export function ReportTable({
  head,
  rows,
  foot,
  testId,
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[] }[];
  foot?: ReactNode[];
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b border-line text-ink-muted">
            {head.map((h, i) => (
              <th key={i} className={cn('px-2 py-1 font-medium', i ? 'text-end' : 'text-start')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line" data-testid="report-row">
              {r.cells.map((c, i) => (
                <td key={i} className={cn('px-2 py-1', i ? 'text-end tabular-nums' : 'text-start')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot ? (
          <tfoot>
            <tr className="font-semibold">
              {foot.map((c, i) => (
                <td key={i} className={cn('px-2 py-1', i ? 'text-end tabular-nums' : 'text-start')}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
