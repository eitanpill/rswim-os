import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@rswim/ui';

const TABS = {
  overview: '/admin/money',
  runs: '/admin/money/runs',
  cash: '/admin/money/cash',
  freezes: '/admin/money/freezes',
} as const;

/** One row of links between the money screens. */
export async function MoneyTabs({ active }: { active: keyof typeof TABS }) {
  const t = await getTranslations('money.tabs');
  return (
    <nav aria-label={t('label')} className="mb-4 flex gap-1 overflow-x-auto">
      {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
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
