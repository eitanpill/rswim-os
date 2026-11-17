import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { mySoleOwnedSchools } from '@rswim/domain-platform';
import { Card, CardTitle, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { fromEveryDatabase, withSignedIn } from '@/lib/db';
import { deleteAccountAction } from './actions';

/**
 * The person's own account: who is signed in, and deleting the account (store launch, stage 8; Apple and Google
 * require it inside the app). What goes and what the school keeps is spelled out before the button.
 */
export default async function MyAccountPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('account');
  const soleOwner = await fromEveryDatabase((database) =>
    withSignedIn((tx) => mySoleOwnedSchools(tx), { database }),
  );
  const blockers = [...new Map(soleOwner.map((s) => [s.orgId, s.name])).values()];
  return (
    <AppShell session={session} surface="account" nav={[]}>
      <PageHeader title={t('title')} subtitle={session.displayName} />
      <Card data-testid="delete-account">
        <CardTitle>{t('delete.title')}</CardTitle>
        <div className="flex flex-col gap-2 text-sm">
          <p>{t('delete.goes')}</p>
          <p className="text-ink-muted">{t('delete.stays')}</p>
        </div>
        {blockers.length ? (
          <p className="mt-3 rounded-xl bg-warn/20 px-3 py-2 text-sm" data-testid="sole-owner">
            {t('delete.soleOwner', { schools: blockers.join(', ') })}
          </p>
        ) : (
          <div className="mt-4">
            <ActionForm action={deleteAccountAction}>
              <Field
                name="confirm"
                label={t('delete.confirm', { word: t('delete.word') })}
                autoComplete="off"
                required
              />
              <div>
                <SubmitButton variant="danger" data-testid="delete-submit">
                  {t('delete.go')}
                </SubmitButton>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
