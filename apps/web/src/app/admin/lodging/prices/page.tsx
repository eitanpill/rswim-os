import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { LodgingTabs, PricesView } from '@/components/lodging/views';

/** The price list: seasons, weekend nights, the Hebrew holidays, and the minimum stay. */
export default async function LodgingPricesPage() {
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-prices-page">
      <PageHeader icon="🛏️" title={t('title')} subtitle={t('subtitle')} />
      <LodgingTabs base="/admin/lodging" current="prices" />
      <PricesView base="/admin/lodging" />
    </div>
  );
}
