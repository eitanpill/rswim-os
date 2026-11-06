import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { checkoutForToken, type CheckoutPageView } from '@rswim/domain-billing';
import { PAYMENT_GATEWAYS } from '@rswim/integrations';
import { ActionForm, SubmitButton } from '@/components/form';
import { money } from '@/lib/billing';
import { payTokenDb } from '@/lib/payments';
import { startPayAction } from '../actions';
import { MethodIcon, PayFrame } from '../ui';

/**
 * The business's payment page (/pay/<token>), from a WhatsApp link, the family's portal or a dive booking. Nobody
 * signs in: the token is the key. One tap per way to pay (a card, Bit, or a standing order), each on the business's
 * own processor; back from the processor the page says whether the money is in.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { token } = await params;
  const { back } = await searchParams;
  const t = await getTranslations('payments.page');
  const v = (await checkoutForToken(await payTokenDb(token), token))?.view;
  if (!v) {
    return (
      <PayFrame business={null} secure={t('secure')}>
        <p className="text-ink-muted" data-testid="pay-not-found">
          {t('notFound')}
        </p>
      </PayFrame>
    );
  }
  const business = v.orgName;
  const amount = (await money())(v.amount);

  return (
    <PayFrame business={business} secure={t('secure')}>
      <section className="rounded-3xl bg-brand-600 p-5 text-white" data-testid="pay-summary">
        <p className="text-sm text-white/80">
          {v.payer ? t('for', { name: v.payer }) : t('title')}
        </p>
        <p className="mt-1 text-lg font-semibold">{v.description}</p>
        {v.purpose === 'mandate' ? (
          <p className="mt-4 text-sm text-white/90">{t('mandateOnly')}</p>
        ) : (
          <>
            <p className="mt-4 text-xs text-white/70">{t('total')}</p>
            <p className="text-4xl font-bold tabular-nums" data-testid="pay-amount">
              {amount}
            </p>
          </>
        )}
      </section>
      <Body v={v} amount={amount} back={back === '1'} token={token} />
    </PayFrame>
  );
}

async function Body({
  v,
  amount,
  back,
  token,
}: {
  v: CheckoutPageView;
  amount: string;
  back: boolean;
  token: string;
}) {
  const t = await getTranslations('payments.page');
  const home =
    v.purpose === 'dive_booking' || v.purpose === 'dive_pass' ? '/dive/me' : '/parent/payments';
  if (v.status === 'paid') {
    return (
      <Notice tone="ok" testId="pay-paid">
        <p className="text-lg font-semibold">
          {v.purpose === 'mandate' ? t('mandateDone') : t('paid', { amount })}
        </p>
        {v.cardLast4 ? (
          <p className="text-sm">
            {t('mandateCard', { last4: v.cardLast4, day: v.chargeDay ?? 1 })}
          </p>
        ) : null}
        {v.method ? <p className="text-sm text-ink-muted">{t(`paidBy.${v.method}`)}</p> : null}
        <p className="text-sm text-ink-muted">{t('receipt')}</p>
        <a href={home} className="text-sm font-medium text-brand-700 underline">
          {t('backHome')}
        </a>
      </Notice>
    );
  }
  if (v.status !== 'open') {
    return (
      <Notice tone="warn" testId="pay-closed">
        <p>{t(v.status === 'expired' ? 'expired' : 'closed')}</p>
      </Notice>
    );
  }
  if (!v.connected) {
    return (
      <Notice tone="warn" testId="pay-unavailable">
        <p>{t('unavailable')}</p>
      </Notice>
    );
  }
  const provider = v.provider ? PAYMENT_GATEWAYS[v.provider].name : null;
  return (
    <div className="flex flex-col gap-3" data-testid="pay-methods">
      {v.failureReason ? (
        <Notice tone="warn" testId="pay-failed">
          <p>{t('failed')}</p>
        </Notice>
      ) : back ? (
        <Notice tone="info" testId="pay-waiting">
          <p>{t('waiting')}</p>
          <a href={`/pay/${token}?back=1`} className="text-sm font-medium underline">
            {t('refresh')}
          </a>
        </Notice>
      ) : null}
      <p className="text-sm font-medium text-ink-muted">{t('how')}</p>
      {v.methods.map((m) => (
        <ActionForm key={m} action={startPayAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="method" value={m} />
          <SubmitButton
            variant={m === v.methods[0] ? 'primary' : 'secondary'}
            className="h-auto min-h-14 w-full justify-start gap-3 py-3 text-start"
            data-testid={`pay-${m}`}
          >
            <MethodIcon method={m} />
            <span className="flex flex-col">
              <span className="text-base font-semibold">{t(`method.${m}`, { amount })}</span>
              <span className="text-xs font-normal opacity-80">
                {t(
                  `methodHint.${m === 'standing_order' && v.purpose === 'mandate' ? 'mandate' : m}`,
                )}
              </span>
            </span>
          </SubmitButton>
        </ActionForm>
      ))}
      <p className="text-xs text-ink-muted">
        {provider ? t('processedBy', { provider }) : null} {t('noCardStored')}
      </p>
    </div>
  );
}

function Notice({
  tone,
  testId,
  children,
}: {
  tone: 'ok' | 'warn' | 'info';
  testId: string;
  children: ReactNode;
}) {
  const cls = {
    ok: 'border-ok/40 bg-ok/10',
    warn: 'border-warn/40 bg-warn/10',
    info: 'border-line bg-surface',
  }[tone];
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-4 ${cls}`} data-testid={testId}>
      {children}
    </div>
  );
}
