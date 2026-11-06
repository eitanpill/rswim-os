import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { asUser } from '@rswim/db';
import { mySchoolDatabase } from '@rswim/domain-platform';
import { getSession } from '@/lib/auth/session';
import { homePath } from '@/lib/auth/routing';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * "Getting your system ready": a new school whose own database is still being made (docs/TENANT-DATABASES.md).
 * The page looks again every few seconds and opens the school as soon as its database is ready.
 */
export default async function PreparingPage() {
  const session = await getSession();
  if (!session?.orgId) redirect('/login');
  const t = await getTranslations('platform.preparing');
  const state = await asUser(db(), { sub: session.userId, org_id: session.orgId }, (tx) =>
    mySchoolDatabase(tx),
  );
  if (state.status === 'ready')
    redirect(session.role === 'owner' ? '/admin/onboarding' : homePath(session));
  const failed = state.status === 'failed';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      {failed ? null : <meta httpEquiv="refresh" content="5" />}
      <div
        aria-hidden
        className={
          failed
            ? 'size-12 rounded-full bg-danger/10'
            : 'size-12 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600'
        }
      />
      <h1 className="text-2xl font-semibold" data-testid="preparing-title">
        {failed ? t('failedTitle') : t('title')}
      </h1>
      <p className="text-ink-muted" data-testid="preparing-status">
        {failed ? t('failed') : t(`step.${state.status}`)}
      </p>
      {failed ? null : <p className="text-sm text-ink-muted">{t('wait')}</p>}
    </main>
  );
}
