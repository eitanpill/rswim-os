import { getTranslations } from 'next-intl/server';
import { ConnectionsView } from '@/components/connections';
import { requireDivePage } from '../_ui/access';
import { Hero } from '../_ui/kit';

/** What the club is connected to and what is still missing (owner only). */
export default async function DiveConnectionsPage() {
  await requireDivePage('connections');
  const t = await getTranslations('connections');
  return (
    <div className="flex flex-col gap-5" data-testid="dive-connections">
      <Hero kicker={t('kicker')} title={t('title')} sub={t('subtitle')} />
      <ConnectionsView vertical="dive" />
    </div>
  );
}
