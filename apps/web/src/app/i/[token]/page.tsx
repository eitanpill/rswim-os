import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { inviteByToken } from '@rswim/domain-copilot';
import { schoolPublic } from '@rswim/domain-platform';
import { ActionForm, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { acrossSchools, withAnon } from '@/lib/db';
import { Frame } from '../../join/[slug]/swim';
import { joinByInviteAction } from './actions';

/** 050-***-4567: enough for the person to recognise their number, not enough for anyone else. */
const masked = (e164: string) => {
  const local = e164.replace(/^\+972/, '0');
  return `${local.slice(0, 3)}-***-${local.slice(-4)}`;
};

/**
 * A personal invite the business's bot sent on WhatsApp. It opens in the app when installed (every screen path is an
 * app link), shows the business, and signs the person in with their own phone; then one tap and they are in.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('leadInvite');
  const invite = await acrossSchools(
    (d) => inviteByToken(d, token),
    (r) => r === null,
  );
  const school = invite ? await withAnon((tx) => schoolPublic(tx, invite.slug)) : null;
  if (!invite || !school)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold">{t('unknownTitle')}</h1>
        <p className="text-ink-muted" data-testid="invite-unknown">
          {t('unknown')}
        </p>
        <Link href="/schools" className="text-brand-600 underline">
          {t('findSchool')}
        </Link>
      </main>
    );

  const session = await getSession();
  const hello = invite.firstName
    ? t('helloName', { name: invite.firstName, school: school.name })
    : t('hello', { school: school.name });

  if (session?.orgId === invite.orgId)
    return (
      <Frame school={school} title={t('inTitle')}>
        <p className="text-ink-muted" data-testid="invite-member">
          {t('in', { school: school.name })}
        </p>
        <Link href="/" className="font-medium text-brand-600 hover:underline">
          {t('toApp')}
        </Link>
      </Frame>
    );

  if (invite.state !== 'open')
    return (
      <Frame school={school} title={t('expiredTitle')}>
        <p className="text-ink-muted" data-testid="invite-expired">
          {invite.state === 'used' ? t('used') : t('expired')}
        </p>
        <Link
          href={`/join/${invite.slug}`}
          className="inline-flex min-h-tap items-center justify-center rounded-xl bg-brand-600 px-4 font-semibold text-white"
        >
          {t('toJoin')}
        </Link>
      </Frame>
    );

  if (!session)
    return (
      <Frame school={school} title={hello} sub={t('sub')}>
        <ol className="flex flex-col gap-2" data-testid="invite-how">
          {[t('how.phone', { phone: masked(invite.phoneE164) }), t('how.code'), t('how.in')].map(
            (s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 dark:bg-surface">
                  {i + 1}
                </span>
                <span dir="auto">{s}</span>
              </li>
            ),
          )}
        </ol>
        <a
          href={`/login/phone?invite=${token}`}
          className="inline-flex min-h-tap items-center justify-center rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
          data-testid="invite-sign-in"
        >
          {t('signIn')}
        </a>
      </Frame>
    );

  return (
    <Frame school={school} title={hello} sub={t('enterSub')}>
      <ActionForm action={joinByInviteAction} testId="invite-join">
        <input type="hidden" name="token" value={token} />
        <SubmitButton data-testid="invite-enter">
          {t('enter', { school: school.name })}
        </SubmitButton>
      </ActionForm>
    </Frame>
  );
}
