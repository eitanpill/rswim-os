import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listVenues } from '@rswim/domain-venues';
import { Badge, buttonVariants, Card, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';

const STATUS_TONE = {
  active: 'ok',
  prospect: 'neutral',
  renovation: 'warn',
  closing: 'warn',
  closed: 'danger',
} as const;

export default async function VenuesPage() {
  const t = await getTranslations('venues');
  const label = await enumLabel();
  const venues = await withSession((tx) => listVenues(tx));
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/venues/migrations" className="text-brand-700 underline">
              {t('migrations')}
            </Link>
            <Link href="/admin/venues/new" className={buttonVariants()}>
              {t('new')}
            </Link>
          </div>
        }
      />
      {venues.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {venues.map((v) => (
            <li key={v.id}>
              <Link href={`/admin/venues/${v.id}`} className="block">
                <Card className="hover:border-brand-500">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">{v.name}</h2>
                    <Badge tone={STATUS_TONE[v.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                      {label('venueStatus', v.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {label('venueKind', v.kind)}
                    {v.city ? ` · ${v.city}` : ''}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
