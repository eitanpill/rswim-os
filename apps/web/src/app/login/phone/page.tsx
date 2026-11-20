import { getTranslations } from 'next-intl/server';
import { inviteByToken } from '@rswim/domain-copilot';
import { Button } from '@rswim/ui';
import { acrossSchools } from '@/lib/db';
import { sendPhoneCode, verifyPhoneCode } from '../actions';
import { inputClass, LoginFrame } from '../login-frame';

export default async function PhoneLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string; join?: string; invite?: string }>;
}) {
  const { phone, error, join, invite } = await searchParams;
  // Came from a club's join link: the actions check the club and send the visitor back to it. From a personal
  // invite: the number it was sent to is ready, and the visitor goes back to the invite to enter.
  const invited = invite
    ? await acrossSchools(
        (d) => inviteByToken(d, invite),
        (r) => r === null,
      )
    : null;
  const joinField = (
    <>
      {join ? <input type="hidden" name="join" value={join} /> : null}
      {invited ? <input type="hidden" name="invite" value={invite} /> : null}
    </>
  );
  const t = await getTranslations('login');
  return (
    <LoginFrame title={t('phoneTitle')} error={error}>
      {phone ? (
        <form action={verifyPhoneCode} className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t('codeSent', { phone })}</p>
          <input type="hidden" name="phone" value={phone} />
          {joinField}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('code')}</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              dir="ltr"
              required
              className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
            />
          </label>
          <Button type="submit" size="full">
            {t('verify')}
          </Button>
        </form>
      ) : (
        <form action={sendPhoneCode} className="flex flex-col gap-3">
          {joinField}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('phone')}</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-0000000"
              defaultValue={invited ? invited.phoneE164.replace(/^\+972/, '0') : undefined}
              dir="ltr"
              required
              className={inputClass}
            />
          </label>
          <Button type="submit" size="full">
            {t('sendCode')}
          </Button>
        </form>
      )}
    </LoginFrame>
  );
}
