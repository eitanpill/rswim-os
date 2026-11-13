import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Badge, Button, Card, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { myFindings } from '@/lib/finding';
import { switchSchoolAction } from '../me/schools/actions';
import { claimFamilyAction, openSchoolLinkAction } from './actions';

const linkButton =
  'inline-flex min-h-tap items-center rounded-xl bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700';

/**
 * The front door for someone signed in with no place yet (one app for everyone): the school that already has their
 * phone ("we found you"), the requests they sent, a school's link or the school search, or opening a school.
 */
export default async function StartPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('start');
  const { matches, requests } = await myFindings();
  return (
    <AppShell session={session} surface="start" nav={[]}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {matches.map((m) => (
          <Card key={m.orgId} data-testid="phone-match" className="border-brand-500">
            <h2 className="mb-1 font-semibold">{t('found.title', { school: m.name })}</h2>
            <p className="mb-3 text-sm text-ink-muted">
              {t(m.vertical === 'freediving' ? 'found.bodyDive' : 'found.body', { school: m.name })}
            </p>
            <ActionButton action={claimFamilyAction} fields={{ orgId: m.orgId }}>
              {t('found.yes')}
            </ActionButton>
          </Card>
        ))}

        {requests.length ? (
          <Card data-testid="my-requests">
            <h2 className="mb-3 font-semibold">{t('requests.title')}</h2>
            <ul className="flex flex-col gap-3">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3"
                >
                  <div>
                    <p className="font-medium">{r.schoolName}</p>
                    <p className="text-sm text-ink-muted">
                      {t(`requests.kind.${r.kind}`)} ·{' '}
                      <Badge
                        tone={
                          r.status === 'accepted'
                            ? 'ok'
                            : r.status === 'declined'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {t(`requests.status.${r.status}`)}
                      </Badge>
                    </p>
                  </div>
                  {r.status === 'accepted' ? (
                    <form action={switchSchoolAction}>
                      <input type="hidden" name="orgId" value={r.orgId} />
                      <Button type="submit" data-testid="enter-school">
                        {t('requests.enter')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-1 font-semibold">{t('search.title')}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t('search.body')}</p>
          <Link href="/schools" className={linkButton} data-testid="start-search">
            {t('search.go')}
          </Link>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">{t('link.title')}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t('link.body')}</p>
          <ActionForm action={openSchoolLinkAction} testId="school-link">
            <Field
              name="link"
              label={t('link.field')}
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              placeholder="https://aqua-swim.co.il/join/…"
            />
            <div>
              <SubmitButton>{t('link.go')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        {matches.length === 0 ? (
          <Card>
            <h2 className="mb-1 font-semibold">{t('phone.title')}</h2>
            <p className="mb-3 text-sm text-ink-muted">{t('phone.body')}</p>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="secondary">
                {t('phone.signOut')}
              </Button>
            </form>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-1 font-semibold">{t('owner.title')}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t('owner.body')}</p>
          <Link href="/onboarding" className={linkButton} data-testid="start-owner">
            {t('owner.go')}
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
