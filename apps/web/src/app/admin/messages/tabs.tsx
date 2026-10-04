import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@rswim/ui';

const TABS = {
  inbox: '/admin/messages',
  log: '/admin/messages/log',
  templates: '/admin/messages/templates',
  broadcast: '/admin/messages/broadcast',
} as const;

/** One row of links between the messaging screens. */
export async function MessagesTabs({ active }: { active: keyof typeof TABS }) {
  const t = await getTranslations('comms.tabs');
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

/** "7.10 18:05" in Israel time. */
export function when(instant: Date | string | null): string {
  if (!instant) return '';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}
