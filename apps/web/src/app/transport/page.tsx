import { getTranslations } from 'next-intl/server';
import { escortDay } from '@rswim/domain-transport';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { RunCard } from '@/components/run-card';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { escortMarkAction, escortStageAction } from './actions';

/**
 * The escort's phone (brief §6.10): today's runs of their routes, opened on first look. One big button for the next
 * stage, and each child to mark on board, not at the pickup, or dropped off. Families hear each stage on WhatsApp.
 */
export default async function EscortHome() {
  const t = await getTranslations('transport.home');
  const today = todayIL();
  const runs = await withSession((tx, ctx) => escortDay(tx, ctx, today));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('today', { date: dmy(today) })} />
      <div className="flex flex-col gap-4">
        {runs.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          runs.map((v) => (
            <RunCard
              key={v.run.id}
              view={v}
              actions={{ stage: escortStageAction, mark: escortMarkAction }}
            />
          ))
        )}
      </div>
    </>
  );
}
