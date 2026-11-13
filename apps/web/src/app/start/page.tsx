import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, Card, PageHeader } from '@rswim/ui';
import { AppShell } from '@/components/app-shell';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { openSchoolLinkAction } from './actions';

/**
 * The front door for someone signed in with no place yet (one app for everyone): a parent or diver who got a link
 * from their school, someone the office already registered by phone, or a school owner about to open a school.
 */
export default async function StartPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const t = await getTranslations('start');
  return (
    <AppShell session={session} surface="start" nav={[]}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
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
        <Card>
          <h2 className="mb-1 font-semibold">{t('phone.title')}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t('phone.body')}</p>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary">
              {t('phone.signOut')}
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">{t('owner.title')}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t('owner.body')}</p>
          <Link
            href="/onboarding"
            className="inline-flex rounded-xl bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
            data-testid="start-owner"
          >
            {t('owner.go')}
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
