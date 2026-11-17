import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LoginFrame } from '../login/login-frame';

/** After someone deleted their account: it is gone, and they may come back any time with a new one. */
export default async function GoodbyePage() {
  const t = await getTranslations('account.goodbye');
  return (
    <LoginFrame title={t('title')}>
      <p className="mb-4 text-ink-muted" data-testid="goodbye">
        {t('body')}
      </p>
      <Link href="/login" className="font-medium text-brand-600 hover:underline">
        {t('back')}
      </Link>
    </LoginFrame>
  );
}
