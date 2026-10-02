import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function LoginFrame({
  title,
  error,
  children,
}: {
  title: string;
  error?: string;
  children: ReactNode;
}) {
  const t = await getTranslations();
  const known = ['invalid', 'phone', 'code', 'no_membership', 'not_configured'];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <p className="text-3xl font-bold text-brand-600">{t('app.name')}</p>
        <p className="text-ink-muted">{t('app.tagline')}</p>
      </div>
      <section className="rounded-card border border-line bg-surface-raised p-5 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {error && known.includes(error) ? (
          <p role="alert" className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {t(`login.errors.${error}`)}
          </p>
        ) : null}
        {children}
      </section>
    </main>
  );
}

export const inputClass =
  'block min-h-tap w-full rounded-xl border border-line bg-surface px-3 text-base focus:outline-2 focus:outline-brand-500';
