import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';

export default async function PlatformHome() {
  const t = await getTranslations('platform.home');
  return (
    <>
      <PageHeader title={t('title')} />
      <Card>
        <EmptyState title={t('empty')} />
      </Card>
    </>
  );
}
