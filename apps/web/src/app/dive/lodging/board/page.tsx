import { getTranslations } from 'next-intl/server';
import { requireDivePage } from '@/app/dive/_ui/access';
import { Hero } from '@/app/dive/_ui/kit';
import { BoardView, LodgingTabs } from '@/components/lodging/views';

/** The occupancy board, and finding and booking a free room or dorm bed. */
export default async function LodgingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; in?: string; out?: string; guests?: string }>;
}) {
  await requireDivePage('lodging');
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-board-page">
      <Hero kicker={t('subtitle')} title={t('title')} />
      <LodgingTabs base="/dive/lodging" current="board" />
      <BoardView base="/dive/lodging" params={await searchParams} />
    </div>
  );
}
