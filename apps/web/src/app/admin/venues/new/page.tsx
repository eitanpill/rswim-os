import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@rswim/ui';
import { createVenueAction } from '../actions';
import { VenueForm } from '../venue-form';

export default async function NewVenuePage() {
  const t = await getTranslations('venues');
  return (
    <>
      <PageHeader title={t('new')} />
      <Card>
        <VenueForm action={createVenueAction} />
      </Card>
    </>
  );
}
