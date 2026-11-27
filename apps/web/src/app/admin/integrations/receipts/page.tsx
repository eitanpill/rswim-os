import { getTranslations } from 'next-intl/server';
import { invoicingConnection } from '@rswim/domain-billing';
import { PageHeader } from '@rswim/ui';
import { ReceiptsConnect } from '@/components/receipts-connect';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { receiptsSandbox } from '@/lib/receipts';

/** The owner connects the school's own Morning account; the office and the accountant see whether one is connected. */
export default async function ReceiptsPage() {
  const session = await requireSurface('admin');
  const t = await getTranslations('receipts');
  const connection = await withSession((tx) => invoicingConnection(tx));
  return (
    <>
      <PageHeader icon="🧾" title={t('title')} subtitle={t('subtitle')} />
      {session.role === 'owner' ? (
        <ReceiptsConnect connection={connection} sandbox={receiptsSandbox()} />
      ) : (
        <p className="text-ink-muted" data-testid="receipts-owner-only">
          {connection?.status === 'connected' ? t('officeConnected') : t('ownerOnly')}
        </p>
      )}
    </>
  );
}
