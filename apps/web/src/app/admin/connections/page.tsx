import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@rswim/ui';
import { ConnectionsView } from '@/components/connections';
import { requireSurface } from '@/lib/auth/session';

/** What the school is connected to and what is still missing (owner and admins). */
export default async function ConnectionsPage() {
  const session = await requireSurface('admin');
  if (session.role !== 'owner' && session.role !== 'admin') redirect('/admin');
  const t = await getTranslations('connections');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConnectionsView vertical="swim" />
    </>
  );
}
