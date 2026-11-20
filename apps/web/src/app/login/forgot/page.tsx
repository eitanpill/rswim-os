import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/form';
import { LoginFrame } from '../login-frame';
import { sendResetLinkAction } from '../password-actions';

/** "Forgot my password": the email gets a link that opens a screen for choosing a new one. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('login.forgot');
  return (
    <LoginFrame title={t('title')}>
      <p className="mb-4 text-sm text-ink-muted">{t('intro')}</p>
      <ActionForm action={sendResetLinkAction} testId="forgot-password" keepValues>
        <Field
          name="email"
          label={t('email')}
          type="email"
          autoComplete="email"
          dir="ltr"
          required
        />
        <SubmitButton size="full">{t('submit')}</SubmitButton>
      </ActionForm>
      <Link
        href="/login"
        className="mt-4 block text-center text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        {t('back')}
      </Link>
    </LoginFrame>
  );
}
