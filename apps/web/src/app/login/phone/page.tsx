import { getTranslations } from 'next-intl/server';
import { Button } from '@rswim/ui';
import { sendPhoneCode, verifyPhoneCode } from '../actions';
import { inputClass, LoginFrame } from '../login-frame';

export default async function PhoneLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string }>;
}) {
  const { phone, error } = await searchParams;
  const t = await getTranslations('login');
  return (
    <LoginFrame title={t('phoneTitle')} error={error}>
      {phone ? (
        <form action={verifyPhoneCode} className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t('codeSent', { phone })}</p>
          <input type="hidden" name="phone" value={phone} />
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
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('phone')}</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-0000000"
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
