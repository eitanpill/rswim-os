import { getTranslations } from 'next-intl/server';
import { invoicingConnection } from '@rswim/domain-billing';
import { ReceiptsConnect } from '@/components/receipts-connect';
import { withSession } from '@/lib/db';
import { receiptsSandbox } from '@/lib/receipts';
import { requireDivePage } from '../_ui/access';
import { Hero } from '../_ui/kit';

/** The club owner connects the club's own Morning account: every paid booking and pass then gets its receipt. */
export default async function DiveReceiptsPage() {
  await requireDivePage('receipts');
  const t = await getTranslations('receipts');
  const connection = await withSession((tx) => invoicingConnection(tx));
  return (
    <div className="flex flex-col gap-5" data-testid="dive-receipts">
      <Hero kicker={t('kicker')} title={t('title')} sub={t('subtitleDive')} />
      <ReceiptsConnect connection={connection} sandbox={receiptsSandbox()} />
    </div>
  );
}
