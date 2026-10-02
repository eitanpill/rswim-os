import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { ADMIN_SECTIONS } from '../nav';

export default async function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in ADMIN_SECTIONS)) notFound();
  const key = section as keyof typeof ADMIN_SECTIONS;
  const t = await getTranslations('admin');
  return (
    <>
      <PageHeader title={t(`nav.${key}`)} />
      <Card>
        <EmptyState title={t('placeholder', { phase: ADMIN_SECTIONS[key] })} />
      </Card>
    </>
  );
}
