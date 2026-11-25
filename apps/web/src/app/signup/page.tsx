import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { publicPlans } from '@rswim/domain-platform';
import { getSession } from '@/lib/auth/session';
import { withAnon } from '@/lib/db';
import { LoginFrame } from '../login/login-frame';
import { resendSignupAction, signUpAction } from './actions';
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
  const tTrial = await getTranslations('platform.trial');
  const plans = process.env.DATABASE_URL ? await withAnon((tx) => publicPlans(tx)) : [];
  const trialDays = plans[0]?.trialDays ?? null;
  if (sent) {
    return (
      <LoginFrame title={t('sentTitle')}>
        <p className="aqua-float mb-2 text-center text-5xl" aria-hidden="true">
          📬
        </p>
        <p data-testid="signup-sent">{t('sentBody', { email: sent })}</p>
        <p className="mt-3 text-sm text-ink-muted">{t('sentHint')}</p>
        <ActionForm action={resendSignupAction} testId="signup-resend" className="mt-4">
          <input type="hidden" name="email" value={sent} />
          <SubmitButton variant="secondary">{t('resend.button')}</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm">
          {t('resend.already')}{' '}
          <Link
            href="/login"
            className="font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            {t('signIn')}
          </Link>
        </p>
      </LoginFrame>
    );
  }
  return (
    <LoginFrame title={t('title')}>
      {trialDays ? (
        <p className="mb-2 flex flex-wrap items-center gap-2" data-testid="signup-trial">
          <span className="aqua-shine rounded-full px-3 py-1 text-sm font-bold text-on-bright">
            🎁 {tTrial('free', { days: trialDays })}
          </span>
        </p>
      ) : null}
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
          className="font-medium text-brand-ink underline-offset-4 hover:underline"
        >
          {t('signIn')}
        </Link>
      </p>
    </LoginFrame>
  );
}
