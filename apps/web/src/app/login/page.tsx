import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@rswim/ui';
import { ACCOUNT_PERSONAS, DIVE_PERSONAS, PERSONAS } from '@rswim/db/personas';
import { demoProfile } from '@rswim/db/demo-profiles';
import { isDemoMode, isDevAuthEnabled, personaName, type DevKey } from '@/lib/auth/dev';
import { signInWithPassword } from './actions';
import { inputClass, LoginFrame } from './login-frame';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string }>;
}) {
  const { error, next, reset } = await searchParams;
  const t = await getTranslations('login');
  const tRole = await getTranslations('common.role');
  if (isDemoMode()) return <DemoLogin resetting={reset === '1'} />;
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
                <span className="text-ink-muted">{personaName(key as DevKey)}</span>
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
            {Object.entries(DIVE_PERSONAS).map(([key, p]) => (
              <a
                key={key}
                href={`/dev/login?as=${key}`}
                className="rounded-xl border border-line px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-surface"
              >
                <span className="block font-medium">🤿 {t(`devDive.${key}`)}</span>
                <span className="text-ink-muted">{p.name}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </LoginFrame>
  );
}

/**
 * The live demo's front door: who you can be, and what each one sees. No passwords, no SMS. The freediving club and
 * the swim school run side by side; the profile decides which comes first, and the platform admin sees both.
 */
async function DemoLogin({ resetting }: { resetting: boolean }) {
  const t = await getTranslations('login.demo');
  const tRole = await getTranslations('common.role');
  const swim = (Object.keys(PERSONAS) as DevKey[]).map((key) => ({
    key,
    role: tRole(PERSONAS[key as keyof typeof PERSONAS].role),
    sees: t(`sees.${key}`),
  }));
  const dive = (Object.keys(DIVE_PERSONAS) as DevKey[]).map((key) => ({
    key,
    role: t(`diveRole.${key}`),
    sees: t(`dive.${key}`),
  }));
  const account = (Object.keys(ACCOUNT_PERSONAS) as DevKey[]).map((key) => ({
    key,
    role: t(`account.${key}`),
    sees: t(`sees.${key}`),
  }));
  const groups = [
    { id: 'dive', title: t('clubGroup'), items: dive },
    { id: 'swim', title: t('swimGroup'), items: swim },
  ];
  if (demoProfile().key !== 'freediving') groups.reverse();
  groups.push({ id: 'platform', title: t('platformGroup'), items: account });
  return (
    <LoginFrame title={t('title')}>
      {resetting ? (
        <p role="status" className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm">
          {t('resetting')}
        </p>
      ) : null}
      <p className="mb-4 text-sm text-ink-muted" data-testid="demo-intro">
        {t('intro')}
      </p>
      <div className="flex flex-col gap-5" data-testid="dev-login">
        {groups.map((g) => (
          <section key={g.id} data-testid={`demo-group-${g.id}`} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted">{g.title}</h2>
            {g.items.map(({ key, role, sees }) => (
              <a
                key={key}
                href={`/dev/login?as=${key}`}
                className="rounded-xl border border-line px-3 py-2 hover:bg-brand-50 dark:hover:bg-surface"
              >
                <span className="block font-medium">
                  {role}
                  <span className="font-normal text-ink-muted"> · {personaName(key)}</span>
                </span>
                <span className="text-sm text-ink-muted">{sees}</span>
              </a>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-muted">{t('footnote')}</p>
    </LoginFrame>
  );
}
