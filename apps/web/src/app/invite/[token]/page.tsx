import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { acceptInviteAction } from './actions';

/** Landing page of a staff invite link: sign in (or sign up) first, then accept. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const t = await getTranslations('invite');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
        <p className="mb-4 text-ink-muted">{t('body')}</p>
        <ActionForm action={acceptInviteAction.bind(null, token)}>
          <div>
            <SubmitButton>{t('accept')}</SubmitButton>
          </div>
        </ActionForm>
        <form action="/auth/signout" method="post" className="mt-4">
          <p className="mb-2 text-sm text-ink-muted">{t('afterAccept')}</p>
          <button type="submit" className="text-brand-700 underline">
            {t('signInAgain')}
          </button>
        </form>
      </Card>
    </main>
  );
}
