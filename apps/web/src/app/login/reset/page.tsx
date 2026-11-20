import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LoginFrame } from '../login-frame';
import { ResetForm } from './reset-form';

/** Where the reset link lands: the person chooses a new password and is signed in. */
export default async function ResetPasswordPage() {
  const t = await getTranslations('login.reset');
  return (
    <LoginFrame title={t('title')}>
      <ResetForm
        labels={{
          password: t('password'),
          hint: t('hint'),
          submit: t('submit'),
          expired: t('errors.expired'),
          again: t('again'),
        }}
      />
      <Link
        href="/login"
        className="mt-4 block text-center text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>
    </LoginFrame>
  );
}
