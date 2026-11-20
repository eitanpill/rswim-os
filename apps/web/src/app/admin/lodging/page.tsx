import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { LodgingTabs, TodayView } from '@/components/lodging/views';

/** Lodging today: arrivals, departures, rooms to prepare and tonight's occupancy. */
export default async function LodgingTodayPage() {
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-today">
      <PageHeader icon="🛏️" title={t('title')} subtitle={t('subtitle')} />
      <LodgingTabs base="/admin/lodging" current="today" />
      <TodayView base="/admin/lodging" />
    </div>
  );
}
