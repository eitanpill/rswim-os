import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listGroups } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { hhmm, staffNames } from '@/lib/scheduling';
import { venuePools } from './choices';

/** All active groups, per venue and weekday, and the way into a new one. */
export default async function GroupsPage() {
  const t = await getTranslations('scheduling.groups');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const { groups, pools, staff } = await withSession(async (tx) => {
    const [groups, pools, staff] = await Promise.all([
      listGroups(tx),
      venuePools(tx),
      listStaff(tx),
    ]);
    return { groups, pools, staff };
  });
  const name = staffNames(staff);
  const venues = [...new Map(pools.map((p) => [p.venueId, p.venueName])).entries()];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href="/admin/board" className="text-brand-700 underline">
            {t('toBoard')}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        {venues.map(([venueId, venueName]) => {
          const mine = groups.filter((g) => g.venueId === venueId);
          return (
            <Card key={venueId}>
              <CardTitle>{venueName}</CardTitle>
              {mine.length === 0 ? (
                <EmptyState title={t('empty')} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {mine.map((g) => (
                    <li key={g.id}>
                      <Link
                        href={`/admin/groups/${g.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 hover:border-brand-500"
                        data-testid="group-row"
                      >
                        <div>
                          <p className="font-medium">{g.name}</p>
                          <p className="text-sm text-ink-muted">
                            {tw(String(g.weekday))} · <span dir="ltr">{hhmm(g.startsAt)}</span> ·{' '}
                            {t('minutes', { n: g.durationMin })}
                            {g.leadStaffId ? ` · ${name(g.leadStaffId)}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {g.admittedGender !== 'mixed' ? (
                            <Badge tone="warn">{label('admittedGender', g.admittedGender)}</Badge>
                          ) : null}
                          {g.leadStaffId ? null : <Badge tone="danger">{t('noLead')}</Badge>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
        <Card>
          <CardTitle>{t('new')}</CardTitle>
          <p className="mb-2 text-sm text-ink-muted">{t('pickPool')}</p>
          <ul className="flex flex-wrap gap-2">
            {pools.map((p) => (
              <li key={p.poolId}>
                <Link
                  href={`/admin/groups/new?pool=${p.poolId}`}
                  className="inline-flex min-h-tap items-center rounded-xl border border-line px-3 hover:border-brand-500"
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
