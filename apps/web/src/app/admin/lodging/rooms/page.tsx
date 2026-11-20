import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { LodgingTabs, RoomsView } from '@/components/lodging/views';

/** The rooms (style, beds, guests, toilet and shower, price) and lodging's settings. */
export default async function LodgingRoomsPage() {
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-rooms-page">
      <PageHeader icon="🛏️" title={t('title')} subtitle={t('subtitle')} />
      <LodgingTabs base="/admin/lodging" current="rooms" />
      <RoomsView />
    </div>
  );
}
