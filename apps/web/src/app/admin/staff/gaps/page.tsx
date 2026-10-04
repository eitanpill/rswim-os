import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { addDays } from '@rswim/calendar';
import { staffingGapsFor } from '@rswim/domain-scheduling';
import { Card, EmptyState, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { StaffOpsTabs } from '../ops-tabs';

/** "Efrat, Sunday 16:00–19:00 has no instructor" (brief §6.8): next month's lessons without a lead, merged. */
export default async function GapsPage() {
  const t = await getTranslations('staffops.gaps');
  const tw = await getTranslations('common.weekday');
  const today = todayIL();
  const gaps = await withSession((tx) =>
    staffingGapsFor(tx, { from: today, to: addDays(today, 30) }),
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <StaffOpsTabs active="gaps" />
      <Card data-testid="staffing-gaps">
        {gaps.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {gaps.map((g) => (
              <li
                key={`${g.venueId}-${g.weekday}-${g.from}`}
                className="rounded-xl border border-line p-3"
                data-testid="staffing-gap"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t('line', {
                      venue: g.venueName,
                      weekday: tw(String(g.weekday)),
                      from: g.from,
                      to: g.to,
                    })}
                  </span>
                  <Link
                    href={`/admin/staff/recruiting?venue=${g.venueId}&day=${g.weekday}`}
                    className="text-sm text-brand-700 underline"
                  >
                    {t('recruit')}
                  </Link>
                </div>
                <p className="text-sm text-ink-muted">
                  {g.groups.join(' · ')} · {t('dates', { n: g.dates.length })}:{' '}
                  {g.dates.map(dmy).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
