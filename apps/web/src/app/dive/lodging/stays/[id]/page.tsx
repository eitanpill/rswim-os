import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { LodgingTabs, StayView } from '@/components/lodging/views';

/** One stay: where, when, who, and moving it along (check in, check out, cancel). */
export default async function LodgingStayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDivePage('lodging');
  const t = await getTranslations('lodging');
  const { id } = await params;
  return (
    <div className="flex flex-col gap-2">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <LodgingTabs base="/dive/lodging" current="board" />
      <StayView base="/dive/lodging" id={id} />
    </div>
  );
}
