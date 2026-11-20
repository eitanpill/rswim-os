import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { LodgingTabs, RoomsView } from '@/components/lodging/views';

/** The rooms (style, beds, guests, toilet and shower, price) and lodging's settings. */
export default async function LodgingRoomsPage() {
  await requireDivePage('lodging');
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-rooms-page">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <LodgingTabs base="/dive/lodging" current="rooms" />
      <RoomsView />
    </div>
  );
}
