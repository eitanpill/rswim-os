import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { mySchools } from '@rswim/domain-platform';
import { Button, buttonVariants, Card, PageHeader } from '@rswim/ui';
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
    <AppShell session={session} surface="schools" nav={[]} backHome>
      <PageHeader icon="🏫" title={t('title')} subtitle={t('subtitle')} />
      <ul className="stagger flex flex-col gap-3" data-testid="my-schools">
        {schools.map((s) => {
          const here = s.orgId === session.orgId;
          return (
            <li key={s.orgId}>
              <Card className={here ? 'border-brand-500' : 'lift'}>
                <form
                  action={switchSchoolAction}
                  className="flex items-center gap-3"
                  data-testid={`school-${s.orgId}`}
                >
                  <input type="hidden" name="orgId" value={s.orgId} />
                  <span
                    aria-hidden
                    className="bg-water grid size-12 shrink-0 place-items-center rounded-2xl text-2xl"
                  >
                    {s.vertical === 'freediving' ? '🤿' : '🏊'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{s.name}</p>
                    {here ? (
                      <span className="mb-0.5 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-ink">
                        {t('current')}
                      </span>
                    ) : null}
                    <p className="text-sm text-ink-muted">
                      {tRole(s.role)} · {t(`vertical.${s.vertical}`)}
                    </p>
                  </div>
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
        <Link href="/start" className={buttonVariants({ variant: 'soft' })}>
          ➕ {t('joinAnother')}
        </Link>
      </p>
    </AppShell>
  );
}
