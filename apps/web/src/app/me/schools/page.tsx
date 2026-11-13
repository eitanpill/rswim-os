import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { mySchools } from '@rswim/domain-platform';
import { Button, Card, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/auth/session';
import { withSignedIn } from '@/lib/db';
import { switchSchoolAction } from './actions';

/**
 * One app for everyone: a person who belongs to more than one school (or holds two roles) picks where to work.
 * The pick is remembered, so next time they land there straight away.
 */
export default async function MySchoolsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('schools');
  const tRole = await getTranslations('common.role');
  const schools = await withSignedIn((tx) => mySchools(tx));
  if (schools.length === 0) redirect('/start');
  return (
    <AppShell session={session} surface="schools" nav={[]}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ul className="flex flex-col gap-3" data-testid="my-schools">
        {schools.map((s) => {
          const here = s.orgId === session.orgId;
          return (
            <li key={s.orgId}>
              <Card>
                <form
                  action={switchSchoolAction}
                  className="flex flex-wrap items-center justify-between gap-3"
                  data-testid={`school-${s.orgId}`}
                >
                  <input type="hidden" name="orgId" value={s.orgId} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="text-sm text-ink-muted">
                      {tRole(s.role)} · {t(`vertical.${s.vertical}`)}
                    </p>
                  </div>
                  {here ? (
                    <span className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700 dark:bg-surface">
                      {t('current')}
                    </span>
                  ) : null}
                  <Button type="submit" variant={here ? 'secondary' : 'primary'}>
                    {t('enter')}
                  </Button>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm">
        <Link href="/start" className="text-brand-700 underline">
          {t('joinAnother')}
        </Link>
      </p>
    </AppShell>
  );
}
