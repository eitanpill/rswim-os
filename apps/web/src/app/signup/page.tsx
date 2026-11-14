import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { LoginFrame } from '../login/login-frame';
import { signUpAction } from './actions';
import { TermsField } from './terms-field';

/** A new business owner creates an account; opening the business itself comes next (/onboarding). */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  if (await getSession()) redirect('/');
  const { sent } = await searchParams;
  const t = await getTranslations('account.signup');
  if (sent) {
    return (
      <LoginFrame title={t('sentTitle')}>
        <p data-testid="signup-sent">{t('sentBody', { email: sent })}</p>
        <p className="mt-3 text-sm text-ink-muted">{t('sentHint')}</p>
      </LoginFrame>
    );
  }
  return (
    <LoginFrame title={t('title')}>
      <p className="mb-4 text-sm text-ink-muted">{t('subtitle')}</p>
      <ActionForm action={signUpAction} testId="signup" keepValues>
        <Field name="name" label={t('name')} autoComplete="name" required />
        <Field
          name="email"
          label={t('email')}
          type="email"
          autoComplete="email"
          dir="ltr"
          required
        />
        <Field
          name="password"
          label={t('password')}
          hint={t('passwordHint')}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
        />
        <TermsField label={t('terms')} />
        <SubmitButton>{t('submit')}</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm">
        {t('haveAccount')}{' '}
        <Link
          href="/login"
          className="font-medium text-brand-600 underline-offset-4 hover:underline"
        >
          {t('signIn')}
        </Link>
      </p>
    </LoginFrame>
  );
}
