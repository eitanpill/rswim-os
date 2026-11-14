import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Vertical } from '@rswim/contracts';
import { schoolDirectory } from '@rswim/domain-platform';
import { getSession } from '@/lib/auth/session';
import { withAnon } from '@/lib/db';
import { inputClass } from '../login/login-frame';

const KINDS = ['all', 'swim', 'freediving'] as const;

/**
 * The app's school search (store launch, stage 4): by name or city, swim schools or freediving clubs. Open before
 * sign-in; a school opens on its join page, where the person signs in and asks to join or for a trial.
 */
export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const { q = '', kind } = await searchParams;
  const only = kind === 'swim' || kind === 'freediving' ? (kind as Vertical) : undefined;
  const t = await getTranslations('schools.search');
  const tApp = await getTranslations('app');
  const session = await getSession();
  const list = await withAnon((tx) => schoolDirectory(tx, q.trim(), only));
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xl font-bold text-brand-600">{tApp('name')}</p>
        <Link
          href={session ? '/start' : '/login'}
          className="text-sm text-ink-muted hover:underline"
        >
          {session ? t('back') : t('signIn')}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-ink-muted">{t('subtitle')}</p>
      </div>
      <form method="get" className="flex flex-col gap-3" role="search" data-testid="school-search">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('field')}</span>
          <input
            name="q"
            defaultValue={q}
            className={inputClass}
            placeholder={t('placeholder')}
            autoComplete="off"
            maxLength={60}
          />
        </label>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('kind')}</legend>
          {KINDS.map((k) => (
            <label
              key={k}
              className="flex min-h-tap cursor-pointer items-center gap-2 rounded-xl border border-line px-3 has-checked:border-brand-500 has-checked:bg-brand-50 dark:has-checked:bg-surface"
            >
              <input type="radio" name="kind" value={k} defaultChecked={(only ?? 'all') === k} />
              {t(`kinds.${k}`)}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="min-h-tap rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
        >
          {t('go')}
        </button>
      </form>
      {list.length ? (
        <ul className="flex flex-col gap-3" data-testid="school-results">
          {list.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/join/${s.slug}`}
                className="block rounded-card border border-line bg-surface-raised p-4 shadow-sm hover:border-brand-500"
              >
                <p className="text-lg font-semibold">{s.name}</p>
                <p className="text-sm text-ink-muted">
                  {t(`kinds.${s.vertical}`)}
                  {s.city ? ` · ${s.city}` : ''}
                </p>
                {s.about ? <p className="mt-1 text-sm">{s.about}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="rounded-card border border-dashed border-line p-6 text-center text-ink-muted"
          data-testid="school-none"
        >
          {t('none')}
        </p>
      )}
      <p className="text-center text-xs text-ink-muted">{t('missing')}</p>
    </main>
  );
}
