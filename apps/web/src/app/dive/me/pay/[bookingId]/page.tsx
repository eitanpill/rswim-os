import { getLocale, getTranslations } from 'next-intl/server';
import { checkoutView } from '@rswim/domain-dive';
import { ActionForm, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { fakeCheckout } from '@/lib/dive-payments';
import { payCheckoutAction } from '../../../actions';
import { requireDivePage } from '../../../_ui/access';
import { dayLabel, heldLong, hhmm, localDay, shekels } from '../../../_ui/format';
import { di } from '../../../_ui/icons';
import { btn, Chip, Empty, Panel } from '../../../_ui/kit';
import { HoldCountdown } from '../../../_ui/motion';

/**
 * Checkout for one booking: the diver sees what they are paying for and how long the seat is held, and pays. The
 * registration counts only once it is paid. Until the club's Grow account is connected this is the demo checkout.
 */
export default async function PayBooking({ params }: { params: Promise<{ bookingId: string }> }) {
  await requireDivePage('me');
  const { bookingId } = await params;
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const v = /^[0-9a-f-]{36}$/i.test(bookingId)
    ? await withSession((tx) => checkoutView(tx, bookingId))
    : null;
  const back = (
    <a href="/dive/me" className={btn.ghost}>
      {t('pay.back')}
    </a>
  );
  if (!v) {
    return (
      <Panel className="pt-4">
        <Empty>{t('pay.notFound')}</Empty>
        <div className="mt-3">{back}</div>
      </Panel>
    );
  }
  const paid = v.status === 'booked' || v.status === 'checked_in';
  const lapsed = v.status === 'pending_payment' && !v.holding;
  const live = fakeCheckout();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4" data-testid="checkout">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--dive-sea)]">
            {t('pay.kicker')}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{t('pay.title')}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--dive-go)_12%,transparent)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--dive-go)_70%,var(--ink))] [&_svg]:size-4">
          {di.shield}
          {t('pay.secure')}
        </span>
      </div>

      <section className="bg-ocean relative overflow-hidden rounded-3xl p-5 text-white">
        <p className="text-xs text-white/70">
          {dayLabel(localDay(v.startsAt), locale)} · {hhmm(v.startsAt)} · {v.siteName}
        </p>
        <p className="mt-1 text-xl font-bold">{v.title}</p>
        <p className="text-sm text-white/80">{v.diverName}</p>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-white/70">{t('pay.total')}</p>
            <p className="text-4xl font-bold tabular-nums" data-testid="checkout-amount">
              {shekels(v.price, locale)}
            </p>
          </div>
          {v.status === 'pending_payment' && v.holdUntil && !lapsed ? (
            <div className="rounded-2xl bg-white/12 px-3 py-2 text-end ring-1 ring-white/20">
              {heldLong(v.holdUntil) ? (
                <>
                  <p className="text-[11px] text-white/70">{t('pay.heldUntil')}</p>
                  <p className="text-sm font-bold">{t('pay.untilSession')}</p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-white/70">{t('pay.heldFor')}</p>
                  <p className="text-lg font-bold">
                    <HoldCountdown until={v.holdUntil} expired={t('pay.lapsedShort')} />
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {paid ? (
        <Panel className="pt-4">
          <div className="flex flex-col items-start gap-3" data-testid="checkout-paid">
            <Chip tone="go">{t('pay.alreadyPaid')}</Chip>
            {back}
          </div>
        </Panel>
      ) : lapsed ? (
        <Panel className="pt-4">
          <div className="flex flex-col items-start gap-3">
            <Chip tone="nogo">{t('pay.lapsed')}</Chip>
            <p className="text-sm text-ink-muted">{t('pay.lapsedHelp')}</p>
            {back}
          </div>
        </Panel>
      ) : v.status !== 'pending_payment' ? (
        <Panel className="pt-4">
          <Empty>{t('pay.notFound')}</Empty>
          <div className="mt-3">{back}</div>
        </Panel>
      ) : !live ? (
        <Panel className="pt-4">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">{t('pay.notLive')}</p>
            {back}
          </div>
        </Panel>
      ) : (
        <Panel
          title={t('pay.card')}
          action={
            <Chip tone="info" icon={false}>
              {t('pay.demo')}
            </Chip>
          }
        >
          {/* The demo card is filled in and never sent anywhere: the fake provider approves it. */}
          <div className="grid grid-cols-2 gap-3 text-sm" aria-hidden="true">
            <div className="col-span-2 rounded-xl border border-line px-3 py-2.5">
              <p className="text-[11px] text-ink-muted">{t('pay.cardNumber')}</p>
              <p dir="ltr" className="text-end font-mono tracking-widest">
                4580 •••• •••• 0000
              </p>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5">
              <p className="text-[11px] text-ink-muted">{t('pay.expiry')}</p>
              <p dir="ltr" className="text-end font-mono">
                12/29
              </p>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5">
              <p className="text-[11px] text-ink-muted">{t('pay.cvv')}</p>
              <p dir="ltr" className="text-end font-mono">
                •••
              </p>
            </div>
          </div>
          <ActionForm action={payCheckoutAction} className="mt-4">
            <input type="hidden" name="bookingId" value={v.bookingId} />
            <SubmitButton className="min-h-12 text-base" data-testid="pay-now">
              {t('pay.payNow', { amount: shekels(v.price, locale) })}
            </SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-muted">{t('pay.note')}</p>
        </Panel>
      )}
    </div>
  );
}
