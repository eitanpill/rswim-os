import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { LodgingTabs, StayView } from '@/components/lodging/views';

/** One stay: where, when, who, and moving it along (check in, check out, cancel). */
export default async function LodgingStayPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations('lodging');
  const { id } = await params;
  return (
    <div className="flex flex-col gap-2">
      <PageHeader icon="🛏️" title={t('title')} subtitle={t('subtitle')} />
      <LodgingTabs base="/admin/lodging" current="board" />
      <StayView base="/admin/lodging" id={id} />
    </div>
  );
}
