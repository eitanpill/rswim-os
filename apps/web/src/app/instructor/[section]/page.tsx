import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@rswim/ui';

const SECTIONS = { profile: '1' } as const;

export default async function InstructorSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!(section in SECTIONS)) notFound();
  const key = section as keyof typeof SECTIONS;
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(`instructor.nav.${key}`)} />
      <Card>
        <EmptyState title={t('admin.placeholder', { phase: SECTIONS[key] })} />
      </Card>
    </>
  );
}
