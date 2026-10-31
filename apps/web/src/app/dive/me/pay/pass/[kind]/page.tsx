import { getLocale, getTranslations } from 'next-intl/server';
import { DIVE_PASS_KINDS, type DivePassKind } from '@rswim/contracts';
import { diverHome, myDiverId } from '@rswim/domain-dive';
import { ActionForm, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { fakeCheckout } from '@/lib/dive-payments';
import { buyPassAction } from '../../../../actions';
import { requireDivePage } from '../../../../_ui/access';
import { shekels } from '../../../../_ui/format';
import { di } from '../../../../_ui/icons';
import { btn, Chip, Empty, Panel } from '../../../../_ui/kit';

/** Checkout for a pass: what it holds, how long it lasts and its price. It is issued only once paid. */
export default async function BuyPass({ params }: { params: Promise<{ kind: string }> }) {
  await requireDivePage('me');
  const { kind } = await params;
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const offer = (DIVE_PASS_KINDS as readonly string[]).includes(kind)
    ? await withSession(async (tx) => {
        const id = await myDiverId(tx);
        const home = id ? await diverHome(tx, id) : null;
        return home?.passOffers.find((o) => o.kind === (kind as DivePassKind)) ?? null;
      })
    : null;
  const back = (
    <a href="/dive/me" className={btn.ghost}>
      {t('pay.back')}
    </a>
  );
  if (!offer) {
    return (
      <Panel className="pt-4">
        <Empty>{t('pay.notFound')}</Empty>
        <div className="mt-3">{back}</div>
      </Panel>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4" data-testid="pass-checkout">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--dive-sea)]">
            {t('pay.kicker')}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{t('pay.passTitle')}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--dive-go)_12%,transparent)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--dive-go)_70%,var(--ink))] [&_svg]:size-4">
          {di.shield}
          {t('pay.secure')}
        </span>
      </div>
      <section className="bg-ocean relative overflow-hidden rounded-3xl p-5 text-white">
        <p className="text-xl font-bold">{t(`passKind.${offer.kind}`)}</p>
        <p className="mt-1 text-sm text-white/80">
          {offer.sessions !== null
            ? t('pay.passHolds', { count: offer.sessions, days: offer.validDays })
            : t('pay.passUnlimited', { days: offer.validDays })}
        </p>
        <p className="mt-5 text-xs text-white/70">{t('pay.total')}</p>
        <p className="text-4xl font-bold tabular-nums" data-testid="checkout-amount">
          {shekels(offer.price, locale)}
        </p>
      </section>
      {fakeCheckout() ? (
        <Panel
          title={t('pay.card')}
          action={
            <Chip tone="info" icon={false}>
              {t('pay.demo')}
            </Chip>
          }
        >
          <ActionForm action={buyPassAction}>
            <input type="hidden" name="kind" value={offer.kind} />
            <SubmitButton className="min-h-12 text-base" data-testid="buy-pass-now">
              {t('pay.payNow', { amount: shekels(offer.price, locale) })}
            </SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-muted">{t('pay.note')}</p>
        </Panel>
      ) : (
        <Panel className="pt-4">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">{t('pay.notLive')}</p>
            {back}
          </div>
        </Panel>
      )}
    </div>
  );
}
