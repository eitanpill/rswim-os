import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { LodgingTabs, TodayView } from '@/components/lodging/views';

/** Lodging today: arrivals, departures, rooms to prepare and tonight's occupancy. */
export default async function LodgingTodayPage() {
  await requireDivePage('lodging');
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-today">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <LodgingTabs base="/dive/lodging" current="today" />
      <TodayView base="/dive/lodging" />
    </div>
  );
}
