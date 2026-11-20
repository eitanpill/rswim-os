import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { BoardView, LodgingTabs } from '@/components/lodging/views';

/** The occupancy board, and finding and booking a free room or dorm bed. */
export default async function LodgingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; in?: string; out?: string; guests?: string }>;
}) {
  const t = await getTranslations('lodging');
  return (
    <div className="flex flex-col gap-2" data-testid="lodging-board-page">
      <PageHeader icon="🛏️" title={t('title')} subtitle={t('subtitle')} />
      <LodgingTabs base="/admin/lodging" current="board" />
      <BoardView base="/admin/lodging" params={await searchParams} />
    </div>
  );
}
