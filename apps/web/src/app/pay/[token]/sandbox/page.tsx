import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckoutMethod } from '@rswim/contracts';
import { checkoutForToken } from '@rswim/domain-billing';
import { PAYMENT_GATEWAYS } from '@rswim/integrations';
import { ActionForm, SubmitButton } from '@/components/form';
import { money } from '@/lib/billing';
import { db } from '@/lib/db';
import { paymentsSandbox } from '@/lib/payments';
import { sandboxAnswerAction } from '../../actions';
import { MethodIcon, PayFrame } from '../../ui';

/**
 * The demo processor's hosted page (sandboxed processes only: local, E2E, the live demo). It plays the business's
 * processor: a card form, a Bit request to the phone, or a card saved for a standing order. Nothing typed here goes
 * anywhere; approving sends the same signed callback a real processor would.
 */
export default async function SandboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  if (!paymentsSandbox()) notFound();
  const { token } = await params;
  const method = CheckoutMethod.safeParse((await searchParams).m);
  const v = (await checkoutForToken(db(), token))?.view;
  if (!v || !method.success) notFound();
  const t = await getTranslations('payments.sandbox');
  const amount = (await money())(v.amount);
  const provider = v.provider ? PAYMENT_GATEWAYS[v.provider].name : PAYMENT_GATEWAYS.fake.name;
  const m = method.data;
  const field = 'rounded-xl border border-line bg-surface px-3 py-2.5';

  return (
    <PayFrame business={provider} secure={t('demo')}>
      <section
        className="rounded-2xl border border-line bg-surface-raised p-4"
        data-testid="sandbox"
      >
        <p className="text-sm text-ink-muted">{t('payTo', { business: v.orgName })}</p>
        <p className="mt-1 font-semibold">{v.description}</p>
        {v.amount > 0 ? <p className="mt-2 text-3xl font-bold tabular-nums">{amount}</p> : null}
      </section>
      <section className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <p className="flex items-center gap-2 font-semibold">
          <MethodIcon method={m} />
          {t(`title.${m}`)}
        </p>
        {m === 'bit' ? (
          <div className="flex flex-col gap-2 text-sm" aria-hidden="true">
            <div className={field}>
              <p className="text-[11px] text-ink-muted">{t('phone')}</p>
              <p dir="ltr" className="text-end font-mono">
                {v.phone ? `${v.phone.slice(0, 7)}•••${v.phone.slice(-2)}` : '05•-•••-••••'}
              </p>
            </div>
            <p className="text-ink-muted">{t('bitSent')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm" aria-hidden="true">
            <div className={`${field} col-span-2`}>
              <p className="text-[11px] text-ink-muted">{t('card')}</p>
              <p dir="ltr" className="text-end font-mono tracking-widest">
                4580 •••• •••• 4242
              </p>
            </div>
            <div className={field}>
              <p className="text-[11px] text-ink-muted">{t('expiry')}</p>
              <p dir="ltr" className="text-end font-mono">
                12/29
              </p>
            </div>
            <div className={field}>
              <p className="text-[11px] text-ink-muted">{t('cvv')}</p>
              <p dir="ltr" className="text-end font-mono">
                •••
              </p>
            </div>
            {m === 'standing_order' ? (
              <p className="col-span-2 text-ink-muted">{t('mandateTerms')}</p>
            ) : null}
          </div>
        )}
        <ActionForm action={sandboxAnswerAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="method" value={m} />
          <input type="hidden" name="answer" value="approve" />
          <SubmitButton className="min-h-12 w-full text-base" data-testid="sandbox-approve">
            {t(`approve.${m}`, { amount })}
          </SubmitButton>
        </ActionForm>
        <ActionForm action={sandboxAnswerAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="method" value={m} />
          <input type="hidden" name="answer" value="decline" />
          <SubmitButton variant="ghost" className="w-full text-sm" data-testid="sandbox-decline">
            {t('decline')}
          </SubmitButton>
        </ActionForm>
        <a href={`/pay/${token}`} className="text-center text-sm text-ink-muted underline">
          {t('cancel')}
        </a>
      </section>
      <p className="text-xs text-ink-muted">{t('note')}</p>
    </PayFrame>
  );
}
