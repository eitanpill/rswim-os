import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { createGroupAction } from '../actions';
import { groupChoices } from '../choices';
import { GroupForm } from '../group-form';

type Search = { pool?: string; program?: string; weekday?: string; startsAt?: string };

/** New group in a pool. The waitlist's "open a group" suggestion links here with the day, hour and program filled. */
export default async function NewGroupPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  if (!q.pool) notFound();
  const pool = q.pool;
  const choices = await withSession((tx) => groupChoices(tx, pool));
  if (!choices) notFound();
  const t = await getTranslations('scheduling.groups');
  return (
    <>
      <PageHeader title={t('new')} />
      <Card>
        <GroupForm
          action={createGroupAction}
          choices={choices}
          defaults={{ programId: q.program, weekday: q.weekday, startsAt: q.startsAt }}
        />
      </Card>
    </>
  );
}
