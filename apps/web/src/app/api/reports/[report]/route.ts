import { getTranslations } from 'next-intl/server';
import {
  CHURN_BUCKETS,
  chargedByVenueProgram,
  churn,
  funnelReport,
  instructorKpis,
  moneyByMonth,
  occupancy,
  shekelsOf,
  toCsv,
  venueProfitability,
  type CsvCell,
} from '@rswim/domain-reports';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { todayIL } from '@/lib/options';
import { rangeFrom } from '@/app/admin/reports/shared';

type Sheet = { header: string[]; rows: CsvCell[][] };

/**
 * Every report as CSV (UTF-8 with a byte-order mark, so Excel shows Hebrew). Office only; the queries run as the
 * signed-in user, so the database decides what is in it. Amounts are shekels as numbers.
 */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  await requireSurface('admin');
  const { report } = await params;
  const q = Object.fromEntries(new URL(req.url).searchParams) as {
    from?: string;
    to?: string;
    date?: string;
  };
  const range = rangeFrom(q);
  const t = await getTranslations('reports');
  const te = await getTranslations('enums.churnReason');
  const tw = await getTranslations('common.weekday');

  const sheet = await withSession(async (tx): Promise<Sheet | null> => {
    switch (report) {
      case 'revenue': {
        const months = await moneyByMonth(tx, range);
        const lines = await chargedByVenueProgram(tx, range);
        return {
          header: [
            t('month'),
            t('venue'),
            t('program'),
            t('revenue.charged'),
            t('revenue.collected'),
          ],
          rows: [
            ...months.map((m) => [
              m.period,
              t('total'),
              '',
              shekelsOf(m.chargedAgorot),
              shekelsOf(m.collectedAgorot),
            ]),
            ...lines.map((l) => [
              l.period,
              l.venue ?? t('noVenue'),
              l.program ?? '',
              shekelsOf(l.amountAgorot),
              null,
            ]),
          ],
        };
      }
      case 'venues': {
        const rows = await venueProfitability(tx, range);
        return {
          header: [
            t('month'),
            t('venue'),
            t('venues.familyRevenue'),
            t('venues.institutionRevenue'),
            t('venues.rent'),
            t('venues.staff'),
            t('venues.marginCol'),
            t('venues.held'),
            t('venues.capacity'),
          ],
          rows: rows.map((r) => [
            r.period,
            r.venue,
            shekelsOf(r.familyRevenue),
            shekelsOf(r.institutionRevenue),
            r.rent === null ? null : shekelsOf(r.rent),
            shekelsOf(r.staffCost),
            shekelsOf(r.margin),
            r.seatsHeld,
            r.capacity,
          ]),
        };
      }
      case 'occupancy': {
        const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayIL();
        const data = await occupancy(tx, date);
        return {
          header: [
            t('venue'),
            t('group'),
            t('occupancy.day'),
            t('occupancy.time'),
            t('venues.held'),
            t('venues.capacity'),
          ],
          rows: data.groups.map((g) => [
            g.venue,
            g.name,
            tw(String(g.weekday)),
            g.startsAt,
            g.held,
            g.capacity,
          ]),
        };
      }
      case 'churn': {
        const data = await churn(tx, range);
        return {
          header: [
            t('month'),
            ...CHURN_BUCKETS.map((b) => (b === 'unknown' ? t('churn.unknown') : te(b))),
            t('total'),
          ],
          rows: [...data.rows, data.totals].map((r) => [
            r.period === 'total' ? t('total') : r.period,
            ...CHURN_BUCKETS.map((b) => r.byReason[b]),
            r.total,
          ]),
        };
      }
      case 'funnel': {
        const data = await funnelReport(tx, range);
        const head = [
          t('funnel.families'),
          t('funnel.trialBooked'),
          t('funnel.trialHeld'),
          t('funnel.enrolled'),
          t('funnel.medianDays'),
        ];
        const line = (kind: string, key: string, r: (typeof data.bySource.rows)[number]) => [
          kind,
          key,
          r.families,
          r.trialBooked,
          r.trialHeld,
          r.enrolled,
          r.medianDaysToEnroll,
        ];
        return {
          header: ['', '', ...head],
          rows: [
            line(t('funnel.bySource'), t('total'), data.bySource.total),
            ...data.bySource.rows.map((r) => line(t('funnel.bySource'), r.key, r)),
            ...data.byBranch.rows.map((r) => line(t('funnel.byBranch'), r.key, r)),
          ],
        };
      }
      case 'instructors': {
        const rows = await instructorKpis(tx, range);
        return {
          header: [
            t('instructors.name'),
            t('instructors.taught'),
            t('instructors.substituted'),
            t('instructors.covered'),
            t('instructors.retention'),
          ],
          rows: rows.map((r) => [
            r.name,
            r.taught,
            r.substituted,
            r.coveredForOthers,
            r.retention.pct,
          ]),
        };
      }
      default:
        return null;
    }
  });
  if (!sheet) return new Response(null, { status: 404 });
  return new Response(toCsv(sheet.header, sheet.rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${report}-${range.from}-${range.to}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
