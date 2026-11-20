import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Badge, Button, buttonVariants, Card, Hero } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { myFindings } from '@/lib/finding';
import { switchSchoolAction } from '../me/schools/actions';
import { claimFamilyAction, openSchoolLinkAction } from './actions';

const linkButton = buttonVariants();

/** A path card's heading with its icon bubble. */
function PathTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <h2 className="mb-1 flex items-center gap-2 font-semibold">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg"
      >
        {icon}
      </span>
      {children}
    </h2>
  );
}

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
      <h1 className="sr-only">{t('title')}</h1>
      <div className="flex flex-col gap-4">
        <Hero emoji="👋" title={t('title')}>
          <p>{t('subtitle')}</p>
        </Hero>
        {matches.map((m) => (
          <Card
            key={m.orgId}
            data-testid="phone-match"
            className="pop-in border-2 border-ok/60 bg-ok/5"
          >
            <PathTitle icon="🎉">{t('found.title', { school: m.name })}</PathTitle>
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
            <div className="mb-2">
              <PathTitle icon="📬">{t('requests.title')}</PathTitle>
            </div>
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
          <PathTitle icon="🔍">{t('search.title')}</PathTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('search.body')}</p>
          <Link href="/schools" className={linkButton} data-testid="start-search">
            {t('search.go')}
          </Link>
        </Card>
        <Card>
          <PathTitle icon="🔗">{t('link.title')}</PathTitle>
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
            <PathTitle icon="📱">{t('phone.title')}</PathTitle>
            <p className="mb-3 text-sm text-ink-muted">{t('phone.body')}</p>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="secondary">
                {t('phone.signOut')}
              </Button>
            </form>
          </Card>
        ) : null}
        <Card>
          <PathTitle icon="🏊">{t('owner.title')}</PathTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('owner.body')}</p>
          <Link href="/onboarding" className={linkButton} data-testid="start-owner">
            {t('owner.go')}
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
