import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CopilotActionStatus } from '@rswim/contracts';
import { isAgentOwner, listAgentActions } from '@rswim/domain-copilot';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { AgentActionList } from '../action-list';

const FILTERS = ['all', 'proposed', 'confirmed', 'failed', 'undone', 'dismissed'] as const;

/**
 * The brain's journal: every action from every channel, newest first, with who asked, how it was decided and an undo
 * button where the action can be taken back. Filter by status with ?status=.
 */
export default async function BrainJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const t = await getTranslations('agent');
  const { status } = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(status ?? '') ? status : 'all';
  const actions = await withSession(async (tx) =>
    (await isAgentOwner(tx))
      ? listAgentActions(tx, {
          statuses: filter === 'all' ? undefined : [filter as CopilotActionStatus],
          limit: 200,
        })
      : [],
  );
  return (
    <>
      <PageHeader
        title={t('journal.title')}
        subtitle={t('journal.subtitle')}
        actions={
          <Link href="/admin/brain" className="text-sm text-brand-700 underline">
            {t('journal.back')}
          </Link>
        }
      />
      <nav className="mb-3 flex flex-wrap gap-2" aria-label={t('journal.filter')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? '/admin/brain/journal' : `/admin/brain/journal?status=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className="flex min-h-tap items-center rounded-full border border-line px-3 text-sm aria-[current=page]:border-brand-500 aria-[current=page]:bg-brand-50 dark:aria-[current=page]:bg-surface"
            data-testid={`journal-filter-${f}`}
          >
            {f === 'all' ? t('journal.all') : t(`status.${f}`)}
          </Link>
        ))}
      </nav>
      <Card data-testid="brain-journal">
        {actions.length ? (
          <AgentActionList actions={actions} />
        ) : (
          <EmptyState title={t('journal.empty')} />
        )}
      </Card>
    </>
  );
}
