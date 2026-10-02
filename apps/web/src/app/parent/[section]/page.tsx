import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';

const SECTIONS: Record<string, string> = {};

export default async function ParentSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in SECTIONS)) notFound();
  const key = section as keyof typeof SECTIONS;
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(`parent.nav.${key}`)} />
      <Card>
        <EmptyState title={t('admin.placeholder', { phase: SECTIONS[key] ?? '' })} />
      </Card>
    </>
  );
}
