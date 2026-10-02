import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';

export default async function Page() {
  const t = await getTranslations('accountant.home');
  return (
    <>
      <PageHeader title={t('title')} />
      <Card>
        <EmptyState title={t('empty')} />
      </Card>
    </>
  );
}
