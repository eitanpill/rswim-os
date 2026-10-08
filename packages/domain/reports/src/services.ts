/**
 * Read-only reporting queries (brief §6.14). Reports are a read model over the other modules' rows: they never write
 * and own no tables except the stored weekly digest, so they read with SQL as the signed-in office user (RLS decides
 * what is visible) instead of calling a service per row (docs/DECISIONS.md, 2026-10-06). Every rule that turns rows
 * into numbers lives in policies.ts.
 */
import { and, eq, schema, sql, type Tx } from '@rswim/db';
import type { InsightKind, InsightSeverity, InsightStatus } from '@rswim/contracts';
import { debtsDashboard } from '@rswim/domain-billing';
import type { ServiceContext } from '@rswim/domain-core';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  buildDigest,
  churnTable,
  detectInsights,
  digestRulesFrom,
  funnel,
  heatmap,
  insightDigestItems,
  insightRulesFrom,
  reconcileInsights,
  monthRange,
  monthsBetween,
  rentForMonth,
  retention,
  venueMargin,
  addMonths,
  type DigestFacts,
  type DigestItem,
  type FamilyFunnelFacts,
  type Insight,
  type InsightDetail,
  type InsightFacts,
  type InsightRules,
  type RentContract,
  type VenueMargin,
} from './policies';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

export async function todayIL(tx: Tx): Promise<string> {
  const [r] = await rows<{ d: string }>(tx, sql`select app.today()::text as d`);
  return (r as { d: string }).d;
}

/** A place that holds a seat (not a lead or a one-day trial seat). */
const SEAT = sql`e.status not in ('lead', 'trial_booked', 'trial_done')`;
/** A lesson that ran or will run. */
const RAN = sql`s.status in ('scheduled', 'completed')`;

export interface PeriodRange {
  /** "YYYY-MM". */
  from: string;
  to: string;
}

// ─── Revenue ────────────────────────────────────────────────────────────────

export interface RevenueLine {
  period: string;
  venueId: string | null;
  venue: string | null;
  programId: string | null;
  program: string | null;
  /** Family charges net of discounts and reversals. */
  amountAgorot: number;
}

/**
 * Family charges per month, venue and program. A charge belongs to the venue where its group's lessons ran that month
 * (so a group that moved venues is split by month), else to the group's venue now; charges with no place (manual
 * entries) have no venue.
 */
export async function chargedByVenueProgram(tx: Tx, range: PeriodRange): Promise<RevenueLine[]> {
  return rows<RevenueLine>(
    tx,
    sql`
    with l as (
      select coalesce(l.period, to_char(l.occurred_on, 'YYYY-MM')) period, l.amount_agorot, l.enrollment_id
      from ledger_entries l
      where l.type in ('charge', 'discount')
    )
    select l.period, v.id "venueId", v.name venue, p.id "programId", p.name_he program,
           sum(l.amount_agorot)::int "amountAgorot"
    from l
    left join enrollments e on e.id = l.enrollment_id
    left join class_templates t on t.id = e.class_template_id
    left join lateral (
      select s.venue_id from sessions s
      where s.class_template_id = t.id and to_char(s.date, 'YYYY-MM') = l.period
      group by s.venue_id order by count(*) desc, s.venue_id limit 1
    ) sv on true
    left join venues v on v.id = coalesce(sv.venue_id, t.venue_id)
    left join programs p on p.id = t.program_id
    where l.period between ${range.from} and ${range.to}
    group by 1, 2, 3, 4, 5
    order by 1, 3 nulls last, 5 nulls last`,
  );
}

export interface MonthMoney {
  period: string;
  chargedAgorot: number;
  collectedAgorot: number;
  institutionInvoicedAgorot: number;
  institutionCollectedAgorot: number;
}

/** Charged and collected per month: families (payments less refunds) and institutions. */
export async function moneyByMonth(tx: Tx, range: PeriodRange): Promise<MonthMoney[]> {
  const charged = await chargedByVenueProgram(tx, range);
  const { from } = monthRange(range.from);
  const { to } = monthRange(range.to);
  const collected = await rows<{ period: string; amount: number }>(
    tx,
    sql`select to_char(paid_on, 'YYYY-MM') period,
               sum(case when kind = 'refund' then -amount_agorot else amount_agorot end)::int amount
        from payments where status = 'succeeded' and paid_on between ${from} and ${to}
        group by 1`,
  );
  const invoiced = await rows<{ period: string; amount: number }>(
    tx,
    sql`select period, sum(amount_agorot)::int amount from institution_invoices
        where status in ('issued', 'paid') and period between ${range.from} and ${range.to} group by 1`,
  );
  const instPaid = await rows<{ period: string; amount: number }>(
    tx,
    sql`select to_char(paid_on, 'YYYY-MM') period, sum(amount_agorot)::int amount from institution_payments
        where paid_on between ${from} and ${to} group by 1`,
  );
  const of = (xs: { period: string; amount: number }[], p: string) =>
    xs.find((x) => x.period === p)?.amount ?? 0;
  return monthsBetween(range.from, range.to).map((period) => ({
    period,
    chargedAgorot: charged
      .filter((c) => c.period === period)
      .reduce((n, c) => n + c.amountAgorot, 0),
    collectedAgorot: of(collected, period),
    institutionInvoicedAgorot: of(invoiced, period),
    institutionCollectedAgorot: of(instPaid, period),
  }));
}

// ─── Venue profitability ────────────────────────────────────────────────────

export interface VenueMonth extends VenueMargin {
  venueId: string;
  venue: string;
  period: string;
  familyRevenue: number;
  institutionRevenue: number;
  rent: number | null;
  staffCost: number;
  seatsHeld: number;
  capacity: number;
  hours: number;
}

/** Revenue against rent and instructor pay, per venue and month, with seat utilization. */
export async function venueProfitability(tx: Tx, range: PeriodRange): Promise<VenueMonth[]> {
  const periods = monthsBetween(range.from, range.to);
  const venues = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, name from venues order by name`,
  );
  const contracts = await rows<RentContract & { venueId: string }>(
    tx,
    sql`select venue_id "venueId", rent_model "rentModel", amount_agorot "amountAgorot",
               starts_on::text "startsOn", ends_on::text "endsOn"
        from venue_contracts`,
  );
  const charged = await chargedByVenueProgram(tx, range);
  const institution = await rows<{ venueId: string; period: string; amount: number }>(
    tx,
    sql`select g.venue_id "venueId", i.period, sum(i.amount_agorot)::int amount
        from institution_invoices i
        join lateral (
          select t.venue_id from institution_contract_groups cg join class_templates t on t.id = cg.class_template_id
          where cg.contract_id = i.contract_id group by t.venue_id order by count(*) desc, t.venue_id limit 1
        ) g on true
        where i.status in ('issued', 'paid') and i.period between ${range.from} and ${range.to}
        group by 1, 2`,
  );
  const usage = await rows<{ venueId: string; period: string; hours: number; laneHours: number }>(
    tx,
    sql`select s.venue_id "venueId", to_char(s.date, 'YYYY-MM') period,
               coalesce((select sum(extract(epoch from upper(r) - lower(r)))
                         from unnest(range_agg(tstzrange(s.starts_at, s.ends_at))) r), 0)::float / 3600 hours,
               sum(extract(epoch from s.ends_at - s.starts_at) / 3600
                   * greatest(1, (select count(*) from class_template_lanes l
                                  where l.class_template_id = s.class_template_id)))::float "laneHours"
        from sessions s
        where ${RAN} and to_char(s.date, 'YYYY-MM') between ${range.from} and ${range.to}
        group by 1, 2`,
  );
  const staff = await rows<{ venueId: string; period: string; amount: number }>(
    tx,
    sql`select s.venue_id "venueId", to_char(s.date, 'YYYY-MM') period, sum(pl.amount_agorot)::int amount
        from payroll_lines pl join sessions s on s.id = pl.session_id
        where to_char(s.date, 'YYYY-MM') between ${range.from} and ${range.to}
        group by 1, 2`,
  );
  const seats = await rows<{ venueId: string; period: string; held: number; capacity: number }>(
    tx,
    sql`select t.venue_id "venueId", m.period,
               sum(t.capacity)::int capacity,
               sum((select count(*) from enrollments e
                    where e.class_template_id = t.id and ${SEAT}
                      and e.starts_on <= m.mid and (e.ends_on is null or e.ends_on > m.mid)))::int held
        from (select to_char(d, 'YYYY-MM') period, (d + interval '14 days')::date mid
              from generate_series(${`${range.from}-01`}::date, ${`${range.to}-01`}::date, interval '1 month') d) m
        join class_templates t on t.status = 'active' and t.cohort_id is null
          and t.effective_from <= m.mid and (t.effective_to is null or t.effective_to > m.mid)
        group by 1, 2`,
  );
  const pick = <T extends { venueId: string; period: string }>(xs: T[], v: string, p: string) =>
    xs.find((x) => x.venueId === v && x.period === p);
  const out: VenueMonth[] = [];
  for (const v of venues) {
    for (const period of periods) {
      const use = pick(usage, v.id, period) ?? { hours: 0, laneHours: 0 };
      const rents = contracts
        .filter((c) => c.venueId === v.id)
        .map((c) => rentForMonth(c, period, use));
      const facts = {
        familyRevenue: charged
          .filter((c) => c.venueId === v.id && c.period === period)
          .reduce((n, c) => n + c.amountAgorot, 0),
        institutionRevenue: pick(institution, v.id, period)?.amount ?? 0,
        rent: rents.some((r) => r === null)
          ? null
          : rents.reduce<number>((n, r) => n + (r as number), 0),
        staffCost: pick(staff, v.id, period)?.amount ?? 0,
        seatsHeld: pick(seats, v.id, period)?.held ?? 0,
        capacity: pick(seats, v.id, period)?.capacity ?? 0,
      };
      if (
        !facts.familyRevenue &&
        !facts.institutionRevenue &&
        !facts.rent &&
        !facts.staffCost &&
        !facts.capacity
      ) {
        continue;
      }
      out.push({
        venueId: v.id,
        venue: v.name,
        period,
        ...facts,
        hours: Math.round(use.hours * 10) / 10,
        ...venueMargin(facts),
      });
    }
  }
  return out;
}

// ─── Occupancy ──────────────────────────────────────────────────────────────

export interface OccupancyGroup {
  id: string;
  name: string;
  venueId: string;
  venue: string;
  weekday: number;
  startsAt: string;
  held: number;
  capacity: number;
}

/** Every regular group running on a date, with the seats held. */
export async function groupsOn(tx: Tx, date: string): Promise<OccupancyGroup[]> {
  return rows<OccupancyGroup>(
    tx,
    sql`select t.id, t.name, t.venue_id "venueId", v.name venue, t.weekday, to_char(t.starts_at, 'HH24:MI') "startsAt",
               t.capacity,
               (select count(*) from enrollments e where e.class_template_id = t.id and ${SEAT}
                  and e.starts_on <= ${date}::date and (e.ends_on is null or e.ends_on > ${date}::date))::int held
        from class_templates t join venues v on v.id = t.venue_id
        where t.status = 'active' and t.cohort_id is null
          and t.effective_from <= ${date}::date and (t.effective_to is null or t.effective_to > ${date}::date)
        order by v.name, t.weekday, t.starts_at`,
  );
}

export async function occupancy(tx: Tx, date: string) {
  const groups = await groupsOn(tx, date);
  const venues = [
    ...new Map(groups.map((g) => [g.venueId, { id: g.venueId, name: g.venue }])).values(),
  ];
  return { date, groups, venues, cells: heatmap(groups) };
}

// ─── Churn ──────────────────────────────────────────────────────────────────

export interface EndedPlaceRow {
  period: string;
  endedOn: string;
  reason: string | null;
  student: string;
  group: string;
  venue: string;
}

/**
 * Places that ended (or will end) in the range: the month of their last day, with the reason recorded on the
 * cancellation. A move to another group (a place that continues as another) and a course that ran its course are
 * not churn.
 */
export async function endedPlaces(tx: Tx, range: PeriodRange): Promise<EndedPlaceRow[]> {
  return rows<EndedPlaceRow>(
    tx,
    sql`select to_char(e.ends_on - 1, 'YYYY-MM') period, (e.ends_on - 1)::text "endedOn",
               (select c.reason from cancellation_requests c
                where c.enrollment_id = e.id and c.status = 'active' order by c.created_at desc limit 1) reason,
               s.first_name || ' ' || s.last_name student, t.name "group", v.name venue
        from enrollments e
        join students s on s.id = e.student_id
        join class_templates t on t.id = e.class_template_id
        join venues v on v.id = t.venue_id
        where e.ends_on is not null and ${SEAT} and e.status <> 'completed' and t.cohort_id is null
          and to_char(e.ends_on - 1, 'YYYY-MM') between ${range.from} and ${range.to}
          and not exists (select 1 from enrollments n where n.previous_enrollment_id = e.id)
        order by e.ends_on, s.first_name`,
  );
}

export async function churn(tx: Tx, range: PeriodRange) {
  const places = await endedPlaces(tx, range);
  return { places, ...churnTable(places, monthsBetween(range.from, range.to)) };
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

/** Families that joined in the range, how they came and how far they got. */
export async function funnelFacts(tx: Tx, range: PeriodRange): Promise<FamilyFunnelFacts[]> {
  const { from } = monthRange(range.from);
  const { to } = monthRange(range.to);
  return rows<FamilyFunnelFacts>(
    tx,
    sql`select
          case when exists (select 1 from guardians g where g.household_id = h.id and g.ghl_contact_id is not null)
               then 'ghl' else 'office' end source,
          coalesce(
            (select v.name from trials tr join students s on s.id = tr.student_id
               join class_templates t on t.id = tr.class_template_id join venues v on v.id = t.venue_id
             where s.household_id = h.id order by tr.created_at limit 1),
            (select v.name from enrollments e join students s on s.id = e.student_id
               join class_templates t on t.id = e.class_template_id join venues v on v.id = t.venue_id
             where s.household_id = h.id and ${SEAT} order by e.created_at limit 1)) branch,
          (h.created_at at time zone 'Asia/Jerusalem')::date::text "createdOn",
          (select min((tr.created_at at time zone 'Asia/Jerusalem')::date)::text from trials tr
             join students s on s.id = tr.student_id where s.household_id = h.id) "trialBookedOn",
          (select min(tr.date)::text from trials tr join students s on s.id = tr.student_id
           where s.household_id = h.id and tr.status = 'attended') "trialHeldOn",
          (select min(greatest((e.created_at at time zone 'Asia/Jerusalem')::date,
                               (h.created_at at time zone 'Asia/Jerusalem')::date))::text
           from enrollments e join students s on s.id = e.student_id
           where s.household_id = h.id and ${SEAT}) "enrolledOn"
        from households h
        where (h.created_at at time zone 'Asia/Jerusalem')::date between ${from}::date and ${to}::date`,
  );
}

export async function funnelReport(tx: Tx, range: PeriodRange) {
  const facts = await funnelFacts(tx, range);
  return { bySource: funnel(facts, 'source'), byBranch: funnel(facts, 'branch') };
}

// ─── Instructor KPIs ────────────────────────────────────────────────────────

export interface InstructorKpi {
  staffId: string;
  name: string;
  taught: number;
  substituted: number;
  coveredForOthers: number;
  retention: { eligible: number; kept: number; pct: number | null };
}

/** Lessons taught, lessons a substitute took over, and children kept three months in the groups they lead. */
export async function instructorKpis(tx: Tx, range: PeriodRange): Promise<InstructorKpi[]> {
  const { from } = monthRange(range.from);
  const { to } = monthRange(range.to);
  const today = await todayIL(tx);
  const staff = await rows<{
    staffId: string;
    name: string;
    taught: number;
    substituted: number;
    covered: number;
  }>(
    tx,
    sql`select m.id "staffId", m.first_name || ' ' || m.last_name name,
               (select count(*) from session_staff ss join sessions s on s.id = ss.session_id
                where ss.staff_member_id = m.id and ss.role in ('lead', 'substitute') and ${RAN}
                  and s.date between ${from}::date and least(${to}::date, ${today}::date))::int taught,
               (select count(*) from substitute_requests r join sessions s on s.id = r.session_id
                where r.from_staff_id = m.id and r.status = 'filled'
                  and s.date between ${from}::date and ${to}::date)::int substituted,
               (select count(*) from session_staff ss join sessions s on s.id = ss.session_id
                where ss.staff_member_id = m.id and ss.role = 'substitute' and ${RAN}
                  and s.date between ${from}::date and least(${to}::date, ${today}::date))::int covered
        from staff_members m where m.status = 'active' order by m.first_name, m.last_name`,
  );
  const places = await rows<{ staffId: string; startsOn: string; endsOn: string | null }>(
    tx,
    sql`select t.lead_staff_id "staffId", e.starts_on::text "startsOn", e.ends_on::text "endsOn"
        from enrollments e join class_templates t on t.id = e.class_template_id
        where t.lead_staff_id is not null and ${SEAT} and t.cohort_id is null`,
  );
  return staff.map((s) => ({
    staffId: s.staffId,
    name: s.name,
    taught: s.taught,
    substituted: s.substituted,
    coveredForOthers: s.covered,
    retention: retention(
      places.filter((p) => p.staffId === s.staffId),
      today,
      3,
    ),
  }));
}

// ─── Weekly digest ──────────────────────────────────────────────────────────

/** Families waiting, grouped by program, venue and first preferred weekday, biggest first. */
async function waitlistClusters(tx: Tx): Promise<DigestFacts['waitlist']> {
  return rows<DigestFacts['waitlist'][number]>(
    tx,
    sql`select p.name_he program, v.name venue, wd.weekday, count(*)::int count
        from waitlist_entries x
        join programs p on p.id = x.program_id
        left join venues v on v.id = x.venue_id
        left join lateral (select x.preferred_weekdays[1]::int weekday) wd on true
        where x.status = 'waiting'
        group by 1, 2, 3 order by 4 desc, 1`,
  );
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The Sunday on or before a date. */
export function sundayOf(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return new Date(t - new Date(t).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
}

/** Everything the digest says, as facts: the week before `weekOf`, today's groups, last month's venues, old debts. */
export async function digestFacts(tx: Tx, weekOf: string): Promise<DigestFacts> {
  const [w] = await rows<{
    from: string;
    to: string;
    lastMonth: string;
    newPlaces: number;
    endedPlaces: number;
    trialsHeld: number;
    trialsEnrolled: number;
    collected: number;
    cancelled: number;
  }>(
    tx,
    sql`with w as (select (${weekOf}::date - 7) f, (${weekOf}::date - 1) t)
        select w.f::text "from", w.t::text "to", to_char(${weekOf}::date - interval '1 month', 'YYYY-MM') "lastMonth",
          (select count(*) from enrollments e where ${SEAT} and e.starts_on between w.f and w.t
             and e.previous_enrollment_id is null)::int "newPlaces",
          (select count(*) from enrollments e where ${SEAT} and e.ends_on - 1 between w.f and w.t
             and not exists (select 1 from enrollments n where n.previous_enrollment_id = e.id))::int "endedPlaces",
          (select count(*) from trials where status = 'attended' and date between w.f and w.t)::int "trialsHeld",
          (select count(*) from trials where status = 'attended' and date between w.f and w.t
             and converted_enrollment_id is not null)::int "trialsEnrolled",
          (select coalesce(sum(case when kind = 'refund' then -amount_agorot else amount_agorot end), 0)
           from payments where status = 'succeeded' and paid_on between w.f and w.t)::int collected,
          (select count(*) from sessions s where s.status in ('cancelled_by_school', 'cancelled_external')
             and s.date between w.f and w.t)::int cancelled
        from w`,
  );
  const week = w as NonNullable<typeof w>;
  const groups = await groupsOn(tx, weekOf);
  const waitlist = await waitlistClusters(tx);
  const venues = await venueProfitability(tx, { from: week.lastMonth, to: week.lastMonth });
  // Debts come from billing's own dashboard (its aging rules), not from the ledger directly.
  const debts = (await debtsDashboard(tx)).rows.map((d) => ({
    household: d.name,
    balanceAgorot: d.balance,
    oldestDays: d.oldest ? daysBetween(d.oldest, weekOf) : 0,
  }));
  return {
    weekOf,
    newPlaces: week.newPlaces,
    endedPlaces: week.endedPlaces,
    trialsHeld: week.trialsHeld,
    trialsEnrolled: week.trialsEnrolled,
    collectedAgorot: week.collected,
    lessonsCancelled: week.cancelled,
    groups: groups.map((g) => ({
      name: g.name,
      venue: g.venue,
      held: g.held,
      capacity: g.capacity,
    })),
    waitlist,
    venues: venues.map((v) => ({
      name: v.venue,
      period: v.period,
      margin: v.margin,
      rentUnknown: v.rentUnknown,
    })),
    debts,
  };
}

export interface WeeklyDigest {
  id: string;
  weekOf: string;
  items: DigestItem[];
  facts: DigestFacts;
  createdAt: Date;
}

/**
 * Builds and stores the digest for the week starting `weekOf` (a Sunday). Running it again for the same week
 * replaces the stored one. Returns null when the digest policy is off.
 */
export async function buildWeeklyDigest(
  tx: Tx,
  ctx: ServiceContext,
  weekOf: string,
): Promise<WeeklyDigest | null> {
  const rules = digestRulesFrom((await resolvePolicyFor(tx, { date: weekOf })).rules);
  if (!rules.enabled) return null;
  const facts = await digestFacts(tx, weekOf);
  const insights = insightRulesFrom((await resolvePolicyFor(tx, { date: weekOf })).rules);
  const extra = insights.enabled
    ? insightDigestItems(detectInsights(await insightFacts(tx, weekOf, insights), insights))
    : [];
  const items = buildDigest(facts, rules, extra);
  const [row] = await tx
    .insert(schema.weeklyDigests)
    .values({ organizationId: ctx.orgId, weekOf, facts, items })
    .onConflictDoUpdate({
      target: [schema.weeklyDigests.organizationId, schema.weeklyDigests.weekOf],
      set: { facts, items, createdAt: new Date() },
    })
    .returning();
  const d = row as typeof schema.weeklyDigests.$inferSelect;
  return { id: d.id, weekOf, items, facts, createdAt: d.createdAt };
}

/** Stored digests, newest first. */
export async function listDigests(tx: Tx, limit = 12): Promise<WeeklyDigest[]> {
  const ds = await tx
    .select()
    .from(schema.weeklyDigests)
    .orderBy(sql`${schema.weeklyDigests.weekOf} desc`)
    .limit(limit);
  return ds.map((d) => ({
    id: d.id,
    weekOf: d.weekOf,
    items: d.items as DigestItem[],
    facts: d.facts as DigestFacts,
    createdAt: d.createdAt,
  }));
}

// ─── Insights ───────────────────────────────────────────────────────────────

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Everything the insight rules look at, as of a date (the coming week for staffing, the coming month for leaving). */
export async function insightFacts(
  tx: Tx,
  asOf: string,
  rules: InsightRules,
): Promise<InsightFacts> {
  const weekEnd = addDays(asOf, 6);
  const monthEnd = addDays(asOf, 31);
  const [now, before, leavingSoon] = await Promise.all([
    groupsOn(tx, asOf),
    groupsOn(tx, addDays(asOf, -rules.lookbackDays)),
    rows<{ id: string; n: number }>(
      tx,
      sql`select e.class_template_id id, count(*)::int n from enrollments e
          where ${SEAT} and e.ends_on > ${asOf}::date and e.ends_on <= ${monthEnd}::date
            and not exists (select 1 from enrollments n where n.previous_enrollment_id = e.id)
          group by 1`,
    ),
  ]);
  const seats = await rows<InsightFacts['seats'][number]>(
    tx,
    sql`select st.household_id "householdId", h.display_name household,
               st.first_name || ' ' || st.last_name student, t.name "group",
               e.status = 'frozen' frozen,
               (e.status = 'cancel_requested' or exists (select 1 from cancellation_requests c
                 where c.enrollment_id = e.id and c.status = 'active')) "cancelRequested",
               coalesce((select array_agg(x.status order by x.date desc) from (
                 select a.status, s.date from attendance a join sessions s on s.id = a.session_id
                 where a.student_id = e.student_id and s.class_template_id = e.class_template_id
                   and a.kind = 'member' and s.date <= ${asOf}::date
                 order by s.date desc limit 6) x), '{}') marks
        from enrollments e
        join students st on st.id = e.student_id
        join households h on h.id = st.household_id
        join class_templates t on t.id = e.class_template_id
        where e.status in ('active', 'frozen', 'cancel_requested') and t.cohort_id is null
          and e.starts_on <= ${asOf}::date and (e.ends_on is null or e.ends_on > ${asOf}::date)
        order by h.display_name, st.first_name`,
  );
  const leaving = await rows<InsightFacts['leaving'][number]>(
    tx,
    sql`select st.household_id "householdId", h.display_name household,
               st.first_name || ' ' || st.last_name student, t.name "group", e.ends_on::text "endsOn", c.reason
        from cancellation_requests c
        join enrollments e on e.id = c.enrollment_id
        join students st on st.id = e.student_id
        join households h on h.id = st.household_id
        join class_templates t on t.id = e.class_template_id
        where c.status = 'active' and e.ends_on > ${asOf}::date and e.ends_on <= ${monthEnd}::date
        order by e.ends_on, h.display_name`,
  );
  const debts = (await debtsDashboard(tx)).rows.map((d) => ({
    householdId: d.householdId,
    household: d.name,
    balanceAgorot: d.balance,
    oldestDays: d.oldest ? daysBetween(d.oldest, asOf) : 0,
  }));
  const prev = addMonths(asOf, -1).slice(0, 7);
  const venues = (await venueProfitability(tx, { from: prev, to: prev })).map((v) => ({
    id: v.venueId,
    name: v.venue,
    period: v.period,
    margin: v.margin,
  }));
  const trials = await rows<InsightFacts['trials'][number]>(
    tx,
    sql`select st.household_id "householdId", h.display_name household,
               st.first_name || ' ' || st.last_name student, max(tr.date)::text date
        from trials tr
        join students st on st.id = tr.student_id
        join households h on h.id = st.household_id
        where tr.status = 'attended' and tr.converted_enrollment_id is null
          and tr.date between ${addDays(asOf, -rules.trialFollowupDays)}::date and ${asOf}::date
          and not exists (select 1 from enrollments e where e.student_id = st.id
                          and e.status in ('active', 'frozen') and (e.ends_on is null or e.ends_on > ${asOf}::date))
        group by 1, 2, 3 order by 4 desc`,
  );
  const uncovered = await rows<InsightFacts['uncovered'][number]>(
    tx,
    sql`select s.id "sessionId", s.date::text date, t.name "group", v.name venue
        from sessions s join class_templates t on t.id = s.class_template_id join venues v on v.id = s.venue_id
        where s.status = 'scheduled' and s.date between ${asOf}::date and ${weekEnd}::date
          and not exists (select 1 from session_staff ss where ss.session_id = s.id and ss.role in ('lead', 'substitute'))
        order by s.date, s.starts_at`,
  );
  const staff = await rows<InsightFacts['staff'][number]>(
    tx,
    sql`select m.id "staffId", m.first_name || ' ' || m.last_name name,
               round((sum(extract(epoch from s.ends_at - s.starts_at)) / 3600)::numeric, 1)::float hours
        from session_staff ss
        join sessions s on s.id = ss.session_id
        join staff_members m on m.id = ss.staff_member_id
        where s.status = 'scheduled' and s.date between ${asOf}::date and ${weekEnd}::date
        group by 1, 2 order by 3 desc`,
  );
  const before_ = new Map(before.map((g) => [g.id, g.held]));
  const leaving_ = new Map(leavingSoon.map((g) => [g.id, g.n]));
  return {
    asOf,
    groups: now.map((g) => ({
      id: g.id,
      name: g.name,
      venue: g.venue,
      held: g.held,
      heldBefore: before_.get(g.id) ?? 0,
      leavingSoon: leaving_.get(g.id) ?? 0,
      capacity: g.capacity,
    })),
    seats,
    leaving,
    debts,
    venues,
    waitlist: await waitlistClusters(tx),
    trials,
    uncovered,
    staff,
  };
}

/** Claude's words on an insight: why it matters and what to do, in Hebrew. */
export interface InsightNote {
  explanation: string;
  recommendation: string;
  model: string;
}

export interface OwnerInsight extends Insight {
  id: string;
  status: InsightStatus;
  note: InsightNote | null;
  firstSeenOn: string;
  lastSeenOn: string;
  snoozedUntil: string | null;
}

const toOwnerInsight = (r: typeof schema.ownerInsights.$inferSelect): OwnerInsight => ({
  id: r.id,
  key: r.key,
  kind: r.kind as InsightKind,
  severity: r.severity as InsightSeverity,
  params: r.params as Insight['params'],
  detail: r.detail as InsightDetail[],
  href: r.href ?? '',
  status: r.status as InsightStatus,
  note: (r.note as InsightNote | null) ?? null,
  firstSeenOn: r.firstSeenOn,
  lastSeenOn: r.lastSeenOn,
  snoozedUntil: r.snoozedUntil,
});

/**
 * The daily check: works out today's insights and brings the stored feed in line (reconcileInsights). Advisory only;
 * it writes nothing but the feed. Returns null when the insights policy is off.
 */
export async function refreshInsights(
  tx: Tx,
  ctx: ServiceContext,
  asOf: string,
): Promise<{ open: number; aiNotes: boolean } | null> {
  const rules = insightRulesFrom((await resolvePolicyFor(tx, { date: asOf })).rules);
  if (!rules.enabled) return null;
  const found = detectInsights(await insightFacts(tx, asOf, rules), rules);
  const stored = await tx.select().from(schema.ownerInsights);
  const changes = reconcileInsights(stored, found, asOf);
  const t = schema.ownerInsights;
  for (const c of changes) {
    if (c.op === 'insert') {
      const i = c.insight;
      await tx.insert(t).values({
        organizationId: ctx.orgId,
        key: i.key,
        kind: i.kind,
        severity: i.severity,
        params: i.params,
        detail: i.detail,
        href: i.href,
        firstSeenOn: asOf,
        lastSeenOn: asOf,
      });
    } else if (c.op === 'update') {
      const i = c.insight;
      await tx
        .update(t)
        .set({
          severity: i.severity,
          params: i.params,
          detail: i.detail,
          href: i.href,
          status: c.status,
          lastSeenOn: asOf,
          ...(c.status === 'open' ? { snoozedUntil: null } : {}),
          ...(c.clearNote ? { note: null } : {}),
        })
        .where(eq(t.key, i.key));
    } else {
      await tx.update(t).set({ status: 'resolved' }).where(eq(t.key, c.key));
    }
  }
  return { open: changes.filter((c) => c.op !== 'resolve').length, aiNotes: rules.aiNotes };
}

const SEVERITY_SQL = sql`case ${schema.ownerInsights.severity} when 'high' then 0 when 'medium' then 1 else 2 end`;

/** The open insights, most severe first. */
export async function listInsights(tx: Tx): Promise<OwnerInsight[]> {
  const r = await tx
    .select()
    .from(schema.ownerInsights)
    .where(eq(schema.ownerInsights.status, 'open'))
    .orderBy(SEVERITY_SQL, schema.ownerInsights.firstSeenOn, schema.ownerInsights.key);
  return r.map(toOwnerInsight);
}

/** Open insights Claude has not written about yet (the worker fills them in). */
export async function insightsWithoutNotes(tx: Tx): Promise<OwnerInsight[]> {
  return (await listInsights(tx)).filter((i) => i.note === null);
}

/** Stores Claude's note, unless the insight's facts changed since it was read (the next check writes it again). */
export async function saveInsightNote(
  tx: Tx,
  q: { id: string; params: unknown; note: InsightNote },
): Promise<boolean> {
  const t = schema.ownerInsights;
  const r = await tx
    .update(t)
    .set({ note: q.note })
    .where(and(eq(t.id, q.id), sql`${t.params} = ${JSON.stringify(q.params)}::jsonb`))
    .returning({ id: t.id });
  return r.length > 0;
}

/** The owner sets an insight aside: it stays hidden until the snooze date, and comes back then if still true. */
export async function dismissInsight(
  tx: Tx,
  ctx: ServiceContext,
  q: { id: string },
): Promise<void> {
  const today = await todayIL(tx);
  const rules = insightRulesFrom((await resolvePolicyFor(tx, { date: today })).rules);
  await tx
    .update(schema.ownerInsights)
    .set({
      status: 'dismissed',
      snoozedUntil: addDays(today, rules.snoozeDays),
      decidedBy: ctx.userId,
      decidedAt: new Date(),
    })
    .where(eq(schema.ownerInsights.id, q.id));
}

// ─── Command center ─────────────────────────────────────────────────────────

/** The owner's home numbers: today's lessons, this month's money, places held now and a month ago. */
export async function homeSummary(tx: Tx, today: string) {
  const period = today.slice(0, 7);
  const [money] = await moneyByMonth(tx, { from: period, to: period });
  const [r] = await rows<{
    lessons: number;
    children: number;
    seats: number;
    seatsBefore: number;
    trials: number;
    drafted: number;
  }>(
    tx,
    sql`select
          (select coalesce(sum(l.amount_agorot), 0) from billing_run_lines l
             join billing_runs r on r.id = l.billing_run_id
           where r.period = ${period} and r.status = 'draft')::int drafted,
          (select count(*) from sessions s where s.status = 'scheduled' and s.date = ${today}::date)::int lessons,
          (select count(*) from sessions s join enrollments e on e.class_template_id = s.class_template_id
             and e.status in ('active', 'cancel_requested') and e.starts_on <= s.date
             and (e.ends_on is null or e.ends_on > s.date)
           where s.status = 'scheduled' and s.date = ${today}::date)::int children,
          (select count(*) from enrollments e where ${SEAT} and e.starts_on <= ${today}::date
             and (e.ends_on is null or e.ends_on > ${today}::date))::int seats,
          (select count(*) from enrollments e where ${SEAT} and e.starts_on <= ${addDays(today, -30)}::date
             and (e.ends_on is null or e.ends_on > ${addDays(today, -30)}::date))::int "seatsBefore",
          (select count(*) from trials where date between ${`${period}-01`}::date and ${today}::date
             and status = 'attended')::int trials`,
  );
  const facts = r as NonNullable<typeof r>;
  const m = money as MonthMoney;
  // Before the month's run is posted, what it will charge is the run's draft.
  return { period, expectedAgorot: m.chargedAgorot || facts.drafted, money: m, ...facts };
}
