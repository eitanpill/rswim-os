import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { LodgingTabs, PricesView } from '@/components/lodging/views';

/** The price list: seasons, weekend nights, the Hebrew holidays, and the minimum stay. */
export default async function LodgingPricesPage() {
  await requireDivePage('lodging');
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-prices-page">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <LodgingTabs base="/dive/lodging" current="prices" />
      <PricesView base="/dive/lodging" />
    </div>
  );
}
