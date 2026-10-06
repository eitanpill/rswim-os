import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@rswim/ui';
import { ACCOUNT_PERSONAS, PERSONAS } from '@rswim/db/personas';
import { isDevAuthEnabled } from '@/lib/auth/dev';
import { signInWithPassword } from './actions';
import { inputClass, LoginFrame } from './login-frame';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const t = await getTranslations('login');
  const tRole = await getTranslations('common.role');
  return (
    <LoginFrame title={t('staffTitle')} error={error}>
      <form action={signInWithPassword} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next ?? '/'} />
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('email')}</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('password')}</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            className={inputClass}
          />
        </label>
        <Button type="submit" size="full">
          {t('submit')}
        </Button>
      </form>
      <Link
        href="/login/phone"
        className="mt-4 block text-center font-medium text-brand-600 underline-offset-4 hover:underline"
      >
        {t('parentsLink')}
      </Link>

      {isDevAuthEnabled() ? (
        <div className="mt-6 border-t border-dashed border-line pt-4" data-testid="dev-login">
          <p className="font-semibold">{t('devTitle')}</p>
          <p className="mb-3 text-sm text-ink-muted">{t('devHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(PERSONAS).map(([key, p]) => (
              <a
                key={key}
                href={`/dev/login?as=${key}`}
                className="rounded-xl border border-line px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-surface"
              >
                <span className="block font-medium">{tRole(p.role)}</span>
                <span className="text-ink-muted">{p.name}</span>
              </a>
            ))}
            {Object.entries(ACCOUNT_PERSONAS).map(([key, p]) => (
              <a
                key={key}
                href={`/dev/login?as=${key}`}
                className="rounded-xl border border-line px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-surface"
              >
                <span className="block font-medium">{t(`devAccount.${key}`)}</span>
                <span className="text-ink-muted">{p.name}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </LoginFrame>
  );
}
