import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PRODUCT } from '@rswim/contracts';
import { cardSetup } from '@rswim/domain-platform';
import { ActionForm, SubmitButton } from '@/components/form';
import { getSession } from '@/lib/auth/session';
import { withControlPlane } from '@/lib/db';
import { SandboxCardVault } from '@rswim/integrations';
import { cardVault } from '@/lib/platform-card';
import { sandboxCardAction } from '../../../actions';

/**
 * The demo processor's card page (sandboxed processes only: local, E2E, the live demo). It plays the platform's
 * processor: nothing typed here goes anywhere, and answering sends the same signed callback a real one would.
 */
export default async function CardSandboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  if (!(cardVault() instanceof SandboxCardVault)) notFound();
  const session = await getSession();
  if (!session?.orgId) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const setup = await withControlPlane((tx) => cardSetup(tx, id));
  if (!setup || setup.status !== 'open') notFound();
  const asked = (await searchParams).back ?? '';
  // Only a path on this site: the link below and the answer's redirect never leave it.
  const back =
    asked.startsWith('/') && !asked.startsWith('//') && !asked.includes('\\')
      ? asked
      : '/billing/card';
  const t = await getTranslations('platform.billing.sandbox');
  const field = 'rounded-xl border border-line bg-surface px-3 py-2.5';
  const answer = (value: string, label: string, variant: 'primary' | 'secondary' | 'ghost') => (
    <ActionForm action={sandboxCardAction}>
      <input type="hidden" name="setup" value={id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="answer" value={value} />
      <SubmitButton variant={variant} className="w-full" data-testid={`card-sandbox-${value}`}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <section
        className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-5"
        data-testid="card-sandbox"
      >
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('payee', { product: PRODUCT.name })}</p>
        <p className="text-sm">{t('body')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm" aria-hidden="true">
          <div className={`${field} col-span-2`}>
            <p dir="ltr" className="text-end font-mono tracking-widest">
              4580 •••• •••• 4242
            </p>
          </div>
          <div className={field}>
            <p dir="ltr" className="text-end font-mono">
              12/29
            </p>
          </div>
          <div className={field}>
            <p dir="ltr" className="text-end font-mono">
              •••
            </p>
          </div>
        </div>
        {answer('approve', t('approve'), 'primary')}
        {answer('approveFail', t('approveFail'), 'secondary')}
        {answer('decline', t('decline'), 'ghost')}
        <a href={back} className="text-center text-sm text-ink-muted underline">
          {t('cancel')}
        </a>
      </section>
      <p className="text-xs text-ink-muted">{t('note')}</p>
    </main>
  );
}
