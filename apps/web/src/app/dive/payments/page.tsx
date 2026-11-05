import { getTranslations } from 'next-intl/server';
import { paymentConnection } from '@rswim/domain-billing';
import { PaymentsConnect } from '@/components/payments-connect';
import { withSession } from '@/lib/db';
import { paymentsSandbox, requestOrigin } from '@/lib/payments';
import { requireDivePage } from '../_ui/access';
import { Hero } from '../_ui/kit';

/** The club owner connects the club's own processor: divers then pay bookings and passes by card or Bit. */
export default async function DivePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  await requireDivePage('payments');
  const t = await getTranslations('payments');
  const { p } = await searchParams;
  const connection = await withSession((tx) => paymentConnection(tx));
  const origin = await requestOrigin();
  return (
    <div className="flex flex-col gap-5" data-testid="dive-payments">
      <Hero kicker={t('kicker')} title={t('title')} sub={t('subtitleDive')} />
      <PaymentsConnect
        connection={connection}
        chosen={p}
        sandbox={paymentsSandbox()}
        basePath="/dive/payments"
        webhookUrl={connection ? `${origin}/api/webhooks/pay/${connection.id}` : null}
      />
    </div>
  );
}
