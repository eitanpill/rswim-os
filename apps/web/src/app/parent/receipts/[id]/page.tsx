import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { receiptView } from '@/lib/receipt';

/** A receipt as the family reads it, with the download (the provider's PDF, or a printable copy under the fake). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('parent.receipt');
  const r = await withSession((tx) => receiptView(tx, id));
  if (!r) notFound();
  return (
    <>
      <PageHeader title={r.title} subtitle={`${r.date}${r.period ? ` · ${r.period}` : ''}`} />
      <Card data-testid="receipt">
        <p>
          {t('client')}: {r.client.name}
          {r.client.nationalId ? <bdi> · {r.client.nationalId}</bdi> : null}
        </p>
        <ul className="my-3 flex flex-col text-sm">
          {r.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 border-t border-line py-2">
              <span>{l.description}</span>
              <span>{l.amount}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          {t('method')}: {r.method}
        </p>
        {r.notes ? (
          <p className="text-sm">
            {t('notes')}: {r.notes}
          </p>
        ) : null}
        <p className="mt-2 text-lg font-semibold">
          {t('total')}: {r.total}
        </p>
        <p className="mt-2 text-xs text-ink-muted">{t('copy')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/receipts/${r.id}`}
            className="min-h-tap inline-flex items-center rounded-xl bg-brand-600 px-4 font-semibold text-white"
            data-testid="receipt-download"
            download
          >
            {t('download')}
          </a>
          <Link
            href="/parent/payments"
            className="min-h-tap inline-flex items-center rounded-xl border border-line px-4"
          >
            {t('back')}
          </Link>
        </div>
      </Card>
    </>
  );
}
