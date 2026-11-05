import { getTranslations } from 'next-intl/server';
import { paymentConnection } from '@rswim/domain-billing';
import { PageHeader } from '@rswim/ui';
import { PaymentsConnect } from '@/components/payments-connect';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { paymentsSandbox, requestOrigin } from '@/lib/payments';

/** The owner connects the school's own processor; the office sees whether one is connected. */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const session = await requireSurface('admin');
  const t = await getTranslations('payments');
  const { p } = await searchParams;
  const connection = await withSession((tx) => paymentConnection(tx));
  const origin = await requestOrigin();
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {session.role === 'owner' ? (
        <PaymentsConnect
          connection={connection}
          chosen={p}
          sandbox={paymentsSandbox()}
          basePath="/admin/integrations/payments"
          webhookUrl={connection ? `${origin}/api/webhooks/pay/${connection.id}` : null}
        />
      ) : (
        <p className="text-ink-muted" data-testid="payments-owner-only">
          {connection?.status === 'connected' ? t('officeConnected') : t('ownerOnly')}
        </p>
      )}
    </>
  );
}
