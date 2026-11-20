import { getFormatter, getTranslations } from 'next-intl/server';
import { cn } from '@rswim/ui';
import { todayIL } from '@/lib/options';

/**
 * A small calendar leaf for a lesson day: weekday on top, the day's number large, the month below. Today is filled
 * in the school's colour, so "what's next" is visible at a glance in any list.
 */
export async function DateChip({ date, className }: { date: string; className?: string }) {
  const format = await getFormatter();
  const t = await getTranslations('common.when');
  const d = new Date(`${date}T12:00:00`);
  const today = date === todayIL();
  return (
    <span
      aria-hidden
      className={cn(
        'flex w-12 shrink-0 flex-col items-center overflow-hidden rounded-xl border text-center leading-none',
        today
          ? 'border-brand-600 bg-brand-600 text-white shadow-[0_6px_14px_-8px_var(--color-brand-600)]'
          : 'border-line bg-surface-raised',
        className,
      )}
    >
      <span
        className={cn(
          'w-full py-1 text-[0.65rem] font-semibold',
          today ? 'bg-white/15' : 'bg-brand-50 text-brand-700',
        )}
      >
        {today ? t('todayShort') : format.dateTime(d, { weekday: 'short' })}
      </span>
      <span className="pt-1 text-lg font-bold tabular-nums">{d.getDate()}</span>
      <span className={cn('pb-1 text-[0.65rem]', today ? 'text-white/90' : 'text-ink-muted')}>
        {format.dateTime(d, { month: 'short' })}
      </span>
    </span>
  );
}
