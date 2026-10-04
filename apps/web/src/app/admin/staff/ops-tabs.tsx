import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@rswim/ui';

const TABS = {
  payroll: '/admin/staff/payroll',
  timesheets: '/admin/staff/timesheets',
  substitutes: '/admin/staff/substitutes',
  gaps: '/admin/staff/gaps',
  recruiting: '/admin/staff/recruiting',
} as const;

/** One row of links between the staff operations screens (payroll, timesheets, substitutes, gaps, recruiting). */
export async function StaffOpsTabs({
  active,
  period,
}: {
  active: keyof typeof TABS;
  /** Carried between the month-based tabs. */
  period?: string;
}) {
  const t = await getTranslations('staffops.tabs');
  const monthly = (k: keyof typeof TABS) => k === 'payroll' || k === 'timesheets';
  return (
    <nav aria-label={t('label')} className="mb-4 flex gap-1 overflow-x-auto">
      {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
        <Link
          key={k}
          href={period && monthly(k) ? `${TABS[k]}?period=${period}` : TABS[k]}
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

/** A month picker that reloads the page with `?period=`. */
export async function PeriodPicker({ period }: { period: string }) {
  const t = await getTranslations('staffops');
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2" data-testid="period-picker">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('period')}
        <input
          type="month"
          name="period"
          defaultValue={period}
          dir="ltr"
          className="min-h-tap rounded-xl border border-line bg-surface px-3 text-base"
        />
      </label>
      <button
        type="submit"
        className="min-h-tap rounded-xl border border-line px-4 text-sm hover:border-brand-500"
      >
        {t('show')}
      </button>
    </form>
  );
}
