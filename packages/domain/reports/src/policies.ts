/**
 * Pure reporting rules (brief §6.14, §6.2 profitability, §6.15 digest; docs/POLICIES.md §16): what a venue's rent
 * costs in a month, its margin, how full a slot is, how leaving places group by reason, how families move through the
 * trial funnel, instructor retention, the CSV every table exports, and the owner's weekly digest. Amounts are integer
 * agorot; every message is an i18n code with params.
 */
import {
  CHURN_REASONS,
  DEFAULT_ORG_RULES,
  type ChurnReason,
  INSIGHT_KINDS,
  type DigestSection,
  type InsightKind,
  type InsightSeverity,
  type InsightStatus,
  type PolicyRules,
  type RentModel,
} from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };

// ─── Months ─────────────────────────────────────────────────────────────────

/** "YYYY-MM" → first and last day. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/** Every month from one period to another, inclusive ("2026-09".."2026-11" → three months). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (let p = from; p <= to;) {
    out.push(p);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
    p = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

// ─── Venue profitability ────────────────────────────────────────────────────

export interface RentContract {
  rentModel: RentModel;
  amountAgorot: number;
  startsOn: string | null;
  endsOn: string | null;
}

/** What the school used of the venue in a month (lessons that ran). */
export interface VenueUsage {
  hours: number;
  laneHours: number;
}

/**
 * The rent one contract costs for a month: the fixed amount, or the rate times the hours (or lane-hours) the school's
 * lessons used. A revenue share has no rate on file, so its cost is unknown (null) rather than guessed.
 */
export function rentForMonth(c: RentContract, period: string, usage: VenueUsage): number | null {
  const { from, to } = monthRange(period);
  if ((c.startsOn !== null && c.startsOn > to) || (c.endsOn !== null && c.endsOn < from)) return 0;
  switch (c.rentModel) {
    case 'fixed_monthly':
      return c.amountAgorot;
    case 'per_hour':
      return Math.round(c.amountAgorot * usage.hours);
    case 'per_lane_hour':
      return Math.round(c.amountAgorot * usage.laneHours);
    case 'revenue_share':
      return null;
    default:
      return 0;
  }
}

export interface VenueMonthFacts {
  /** Family charges (net of discounts) for the venue's groups that month. */
  familyRevenue: number;
  /** Institution invoices for contracts whose groups are at the venue. */
  institutionRevenue: number;
  /** Rent; null when a contract's cost is unknown (revenue share). */
  rent: number | null;
  /** Payroll lines of lessons at the venue. */
  staffCost: number;
  seatsHeld: number;
  capacity: number;
}

export interface VenueMargin {
  revenue: number;
  cost: number;
  margin: number;
  /** Margin as a share of revenue, rounded; null with no revenue. */
  marginPct: number | null;
  utilizationPct: number | null;
  /** The rent part is unknown, so the margin leaves it out. */
  rentUnknown: boolean;
}

export function venueMargin(f: VenueMonthFacts): VenueMargin {
  const revenue = f.familyRevenue + f.institutionRevenue;
  const cost = (f.rent ?? 0) + f.staffCost;
  const margin = revenue - cost;
  return {
    revenue,
    cost,
    margin,
    marginPct: revenue > 0 ? Math.round((margin * 100) / revenue) : null,
    utilizationPct: occupancyPct(f.seatsHeld, f.capacity),
    rentUnknown: f.rent === null,
  };
}

// ─── Occupancy ──────────────────────────────────────────────────────────────

/** Seats held out of capacity, as a rounded percentage; null when there is no capacity. */
export function occupancyPct(held: number, capacity: number): number | null {
  return capacity > 0 ? Math.round((held * 100) / capacity) : null;
}

export interface OccupancyRules {
  highPct: number;
  lowPct: number;
}

export type HeatLevel = 'none' | 'low' | 'mid' | 'high' | 'full';

/** The heatmap colour for a cell: under the low mark, between, at or above the high mark, or full. */
export function heatLevel(pct: number | null, rules: OccupancyRules): HeatLevel {
  if (pct === null) return 'none';
  if (pct >= 100) return 'full';
  if (pct >= rules.highPct) return 'high';
  if (pct < rules.lowPct) return 'low';
  return 'mid';
}

export interface SlotGroup {
  venueId: string;
  weekday: number;
  /** "HH:MM" start. */
  startsAt: string;
  held: number;
  capacity: number;
}

export interface HeatCell {
  venueId: string;
  weekday: number;
  hour: number;
  held: number;
  capacity: number;
  groups: number;
  pct: number | null;
}

/** Groups summed into venue × weekday × hour cells, ordered by venue, day and hour. */
export function heatmap(groups: readonly SlotGroup[]): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  for (const g of groups) {
    const hour = Number(g.startsAt.slice(0, 2));
    const key = `${g.venueId}|${g.weekday}|${hour}`;
    const c = cells.get(key) ?? {
      venueId: g.venueId,
      weekday: g.weekday,
      hour,
      held: 0,
      capacity: 0,
      groups: 0,
      pct: null,
    };
    c.held += g.held;
    c.capacity += g.capacity;
    c.groups += 1;
    cells.set(key, c);
  }
  return [...cells.values()]
    .map((c) => ({ ...c, pct: occupancyPct(c.held, c.capacity) }))
    .sort((a, b) =>
      a.venueId !== b.venueId
        ? a.venueId < b.venueId
          ? -1
          : 1
        : a.weekday - b.weekday || a.hour - b.hour,
    );
}

// ─── Churn ──────────────────────────────────────────────────────────────────

export type ChurnBucket = ChurnReason | 'unknown';
export const CHURN_BUCKETS: readonly ChurnBucket[] = [...CHURN_REASONS, 'unknown'];

export interface EndedPlace {
  /** The month the place ended (its last day). */
  period: string;
  reason: string | null;
}

export interface ChurnRow {
  period: string;
  total: number;
  byReason: Record<ChurnBucket, number>;
}

const emptyBuckets = () =>
  Object.fromEntries(CHURN_BUCKETS.map((r) => [r, 0])) as Record<ChurnBucket, number>;

const bucketOf = (reason: string | null): ChurnBucket =>
  (CHURN_REASONS as readonly string[]).includes(reason ?? '') ? (reason as ChurnReason) : 'unknown';

/** Places that ended, per month and reason (a place with no recorded reason counts as unknown). */
export function churnTable(
  ended: readonly EndedPlace[],
  periods: readonly string[],
): { rows: ChurnRow[]; totals: ChurnRow } {
  const rows = periods.map((period) => ({ period, total: 0, byReason: emptyBuckets() }));
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const totals: ChurnRow = { period: 'total', total: 0, byReason: emptyBuckets() };
  for (const e of ended) {
    const row = byPeriod.get(e.period);
    if (!row) continue;
    const b = bucketOf(e.reason);
    row.total += 1;
    row.byReason[b] += 1;
    totals.total += 1;
    totals.byReason[b] += 1;
  }
  return { rows, totals };
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export interface FamilyFunnelFacts {
  /** Where the family came from: `ghl` (LeadYourWay contact) or `office`. */
  source: string;
  /** The venue of the family's first trial (or first group); null before either. */
  branch: string | null;
  createdOn: string;
  trialBookedOn: string | null;
  trialHeldOn: string | null;
  enrolledOn: string | null;
}

export interface FunnelRow {
  key: string;
  families: number;
  trialBooked: number;
  trialHeld: number;
  enrolled: number;
  /** enrolled / families, rounded percent; null with no families. */
  conversionPct: number | null;
  /** trialHeld → enrolled, rounded percent; null when no trial was held. */
  trialConversionPct: number | null;
  medianDaysToEnroll: number | null;
}

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The middle value (the mean of the two middle values for an even count), rounded; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(
    s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2,
  );
}

function funnelRow(key: string, rows: readonly FamilyFunnelFacts[]): FunnelRow {
  const enrolled = rows.filter((r) => r.enrolledOn !== null);
  const held = rows.filter((r) => r.trialHeldOn !== null).length;
  return {
    key,
    families: rows.length,
    trialBooked: rows.filter((r) => r.trialBookedOn !== null).length,
    trialHeld: held,
    enrolled: enrolled.length,
    conversionPct: rows.length ? Math.round((enrolled.length * 100) / rows.length) : null,
    trialConversionPct: held
      ? Math.round(
          (rows.filter((r) => r.trialHeldOn !== null && r.enrolledOn !== null).length * 100) / held,
        )
      : null,
    medianDaysToEnroll: median(enrolled.map((r) => days(r.createdOn, r.enrolledOn as string))),
  };
}

/** The funnel overall and split by a key (source or branch; families with no branch yet go under "none"). */
export function funnel(
  rows: readonly FamilyFunnelFacts[],
  by: 'source' | 'branch',
): { total: FunnelRow; rows: FunnelRow[] } {
  const groups = new Map<string, FamilyFunnelFacts[]>();
  for (const r of rows) {
    const key = (by === 'source' ? r.source : r.branch) ?? 'none';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return {
    total: funnelRow('total', rows),
    rows: [...groups.entries()]
      .map(([k, v]) => funnelRow(k, v))
      .sort((a, b) => b.families - a.families || (a.key < b.key ? -1 : 1)),
  };
}

// ─── Instructor KPIs ────────────────────────────────────────────────────────

export interface LedPlace {
  startsOn: string;
  /** Exclusive end; null while the child stays. */
  endsOn: string | null;
}

/** The date some whole months after a date (clamped to the month's last day). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Children kept after `months`: of the places in an instructor's groups that started at least that long before
 * `asOf`, the share still there at the mark. Null when no place is old enough to tell.
 */
export function retention(
  places: readonly LedPlace[],
  asOf: string,
  months: number,
): { eligible: number; kept: number; pct: number | null } {
  const eligible = places.filter((p) => addMonths(p.startsOn, months) <= asOf);
  const kept = eligible.filter(
    (p) => p.endsOn === null || p.endsOn > addMonths(p.startsOn, months),
  );
  return {
    eligible: eligible.length,
    kept: kept.length,
    pct: eligible.length ? Math.round((kept.length * 100) / eligible.length) : null,
  };
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export type CsvCell = string | number | null;

/** A cell as CSV: quoted when needed, and text that a spreadsheet would run as a formula is defused. */
export function csvCell(v: CsvCell): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** UTF-8 CSV with a byte-order mark (so Excel shows Hebrew) and CRLF line ends. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Agorot as shekels with two decimals, for spreadsheets (a number, not a formatted string). */
export const shekelsOf = (agorot: number) => Math.round(agorot) / 100;

// ─── Weekly digest ──────────────────────────────────────────────────────────

export interface DigestRules {
  highOccupancyPct: number;
  lowOccupancyPct: number;
  debtAttentionDays: number;
  waitlistClusterMin: number;
}

/** The digest's thresholds from the resolved policy (the waitlist mark is the one that suggests opening a group). */
export function digestRulesFrom(rules: PolicyRules): DigestRules & { enabled: boolean } {
  const d = { ...DEFAULT_ORG_RULES.digest, ...rules.digest };
  return {
    enabled: d.enabled as boolean,
    highOccupancyPct: d.high_occupancy_pct as number,
    lowOccupancyPct: d.low_occupancy_pct as number,
    debtAttentionDays: d.debt_attention_days as number,
    waitlistClusterMin: { ...DEFAULT_ORG_RULES.scheduling, ...rules.scheduling }
      .open_group_min_waiting as number,
  };
}

export interface DigestFacts {
  /** The Sunday the week starts (the digest covers the seven days before it). */
  weekOf: string;
  newPlaces: number;
  endedPlaces: number;
  trialsHeld: number;
  trialsEnrolled: number;
  collectedAgorot: number;
  lessonsCancelled: number;
  groups: { name: string; venue: string; held: number; capacity: number }[];
  waitlist: { program: string; venue: string | null; weekday: number | null; count: number }[];
  /** Last month's margin per venue. */
  venues: { name: string; period: string; margin: number; rentUnknown: boolean }[];
  /** Households with an open balance, and the age of their oldest unpaid charge. */
  debts: { household: string; balanceAgorot: number; oldestDays: number }[];
}

export interface DigestItem {
  section: DigestSection;
  code: string;
  params: Record<string, string | number>;
}

const item = (
  section: DigestSection,
  code: string,
  params: DigestItem['params'] = {},
): DigestItem => ({
  section,
  code: `reports.digest.items.${code}`,
  params,
});

/**
 * The owner's Sunday digest: what happened last week, what needs attention (venues losing money, old debts, groups
 * running near empty), and suggestions (open a group where the waitlist clusters, raise the price where a group is
 * nearly full).
 */
export function buildDigest(
  f: DigestFacts,
  rules: DigestRules,
  /** The insights feed's own items (insightDigestItems), shown with the digest's. */
  extra: readonly DigestItem[] = [],
): DigestItem[] {
  const items: DigestItem[] = [
    item('happened', 'places', { started: f.newPlaces, ended: f.endedPlaces }),
    item('happened', 'trials', { held: f.trialsHeld, enrolled: f.trialsEnrolled }),
    item('happened', 'collected', { amount: f.collectedAgorot }),
  ];
  if (f.lessonsCancelled > 0)
    items.push(item('happened', 'cancelled', { count: f.lessonsCancelled }));

  for (const v of f.venues.filter((x) => x.margin < 0)) {
    items.push(
      item('attention', 'venueLoss', { venue: v.name, period: v.period, amount: -v.margin }),
    );
  }
  const old = f.debts
    .filter((d) => d.oldestDays >= rules.debtAttentionDays)
    .sort((a, b) => b.balanceAgorot - a.balanceAgorot);
  if (old.length) {
    items.push(
      item('attention', 'oldDebts', {
        count: old.length,
        amount: old.reduce((n, d) => n + d.balanceAgorot, 0),
        days: rules.debtAttentionDays,
        top: old
          .slice(0, 3)
          .map((d) => d.household)
          .join(', '),
      }),
    );
  }
  for (const g of f.groups) {
    const pct = occupancyPct(g.held, g.capacity);
    if (pct === null) continue;
    if (pct < rules.lowOccupancyPct) {
      items.push(item('attention', 'lowGroup', { group: g.name, venue: g.venue, pct }));
    } else if (pct >= rules.highOccupancyPct) {
      items.push(item('suggestion', 'raisePrice', { group: g.name, venue: g.venue, pct }));
    }
  }
  for (const w of f.waitlist.filter((x) => x.count >= rules.waitlistClusterMin)) {
    items.push(
      item('suggestion', 'openGroup', {
        program: w.program,
        venue: w.venue ?? '',
        day: w.weekday ?? -1,
        count: w.count,
      }),
    );
  }
  items.push(...extra);
  if (!items.some((i) => i.section === 'attention')) items.push(item('attention', 'allClear'));
  return items;
}

// ─── Insights ───────────────────────────────────────────────────────────────

export interface InsightRules {
  lookbackDays: number;
  emptyingDropSeats: number;
  churnAbsences: number;
  staffMaxWeeklyHours: number;
  trialFollowupDays: number;
  debtAttentionDays: number;
  lowOccupancyPct: number;
  waitlistClusterMin: number;
}

/** The insights' thresholds from the resolved policy (debts, occupancy and the waitlist mark are the digest's own). */
export function insightRulesFrom(
  rules: PolicyRules,
): InsightRules & { enabled: boolean; aiNotes: boolean; snoozeDays: number } {
  const i = { ...DEFAULT_ORG_RULES.insights, ...rules.insights };
  const d = digestRulesFrom(rules);
  return {
    enabled: i.enabled as boolean,
    aiNotes: i.ai_notes as boolean,
    snoozeDays: i.snooze_days as number,
    lookbackDays: i.lookback_days as number,
    emptyingDropSeats: i.emptying_drop_seats as number,
    churnAbsences: i.churn_absences as number,
    staffMaxWeeklyHours: i.staff_max_weekly_hours as number,
    trialFollowupDays: i.trial_followup_days as number,
    debtAttentionDays: d.debtAttentionDays,
    lowOccupancyPct: d.lowOccupancyPct,
    waitlistClusterMin: d.waitlistClusterMin,
  };
}

export interface InsightFacts {
  asOf: string;
  /** Regular groups running today, with the seats held `lookbackDays` ago and the places ending in the coming month. */
  groups: {
    id: string;
    name: string;
    venue: string;
    held: number;
    heldBefore: number;
    leavingSoon: number;
    capacity: number;
  }[];
  /** Every child holding a seat today, with their latest attendance marks (newest first). */
  seats: {
    householdId: string;
    household: string;
    student: string;
    group: string;
    marks: string[];
    frozen: boolean;
    cancelRequested: boolean;
  }[];
  /** Places a family asked to end, ending within the coming month. */
  leaving: {
    householdId: string;
    household: string;
    student: string;
    group: string;
    endsOn: string;
    reason: string | null;
  }[];
  debts: { householdId: string; household: string; balanceAgorot: number; oldestDays: number }[];
  /** Last month's margin per venue. */
  venues: { id: string; name: string; period: string; margin: number }[];
  waitlist: { program: string; venue: string | null; weekday: number | null; count: number }[];
  /** Trials held within the follow-up window whose child has no place yet. */
  trials: { householdId: string; household: string; student: string; date: string }[];
  /** Lessons in the coming week with no instructor on them. */
  uncovered: { sessionId: string; date: string; group: string; venue: string }[];
  /** Instructors' teaching hours in the coming week. */
  staff: { staffId: string; name: string; hours: number }[];
}

export type InsightDetail = Record<string, string | number | boolean | null>;

export interface Insight {
  key: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** i18n params for `insights.kinds.<kind>.title` and `.action`. */
  params: Record<string, string | number>;
  detail: InsightDetail[];
  href: string;
}

/** A short, stable fingerprint of a set of ids (FNV-1a), so an insight about other families is a new insight. */
export function fingerprint(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...new Set(ids)].sort().join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Absences in a row from the newest mark back. */
export function absenceStreak(marks: readonly string[]): number {
  const n = marks.findIndex((m) => m !== 'absent');
  return n === -1 ? marks.length : n;
}

export interface ChurnSignal {
  householdId: string;
  household: string;
  student: string;
  group: string;
  absencesInARow: number;
  recentAbsences: number;
  frozen: boolean;
  debtDays: number;
  score: number;
}

/**
 * How likely a child is to leave, from what the school already knows: absences in a row (2 points), several recent
 * absences (1), a frozen place (1), an old debt (1). Two points or more is a risk. Children whose family already asked
 * to leave are not a risk any more; they are leaving.
 */
export function churnSignals(f: InsightFacts, rules: InsightRules): ChurnSignal[] {
  const out: ChurnSignal[] = [];
  for (const s of f.seats) {
    if (s.cancelRequested) continue;
    const absencesInARow = absenceStreak(s.marks);
    const recentAbsences = s.marks.slice(0, 4).filter((m) => m === 'absent').length;
    const debt = f.debts.find((d) => d.householdId === s.householdId);
    const debtDays = debt?.oldestDays ?? 0;
    const score =
      (absencesInARow >= rules.churnAbsences ? 2 : recentAbsences >= 2 ? 1 : 0) +
      (s.frozen ? 1 : 0) +
      (debtDays >= rules.debtAttentionDays ? 1 : 0);
    if (score >= 2) {
      out.push({
        householdId: s.householdId,
        household: s.household,
        student: s.student,
        group: s.group,
        absencesInARow,
        recentAbsences,
        frozen: s.frozen,
        debtDays,
        score,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || (a.household < b.household ? -1 : 1));
}

const names = (xs: readonly { household: string }[], max = 5) =>
  [...new Set(xs.map((x) => x.household))].slice(0, max).join(', ');

const SEVERITY_ORDER: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * What the owner should look at, worked out from the facts (advisory only: nothing here changes data). Each rule
 * gives an i18n title and recommendation with params, the subjects behind it, and the screen to open.
 */
export function detectInsights(f: InsightFacts, rules: InsightRules): Insight[] {
  const out: Insight[] = [];

  for (const g of f.groups) {
    const staying = g.held - g.leavingSoon;
    const drop = g.heldBefore - staying;
    if (drop < rules.emptyingDropSeats || g.capacity === 0) continue;
    const pct = occupancyPct(Math.max(staying, 0), g.capacity) as number;
    out.push({
      key: `group_emptying:${g.id}`,
      kind: 'group_emptying',
      severity: pct < rules.lowOccupancyPct ? 'high' : 'medium',
      params: {
        group: g.name,
        venue: g.venue,
        before: g.heldBefore,
        now: Math.max(staying, 0),
        capacity: g.capacity,
        days: rules.lookbackDays,
      },
      detail: [{ leavingSoon: g.leavingSoon, held: g.held, pct }],
      href: `/admin/groups/${g.id}`,
    });
  }

  const churn = churnSignals(f, rules);
  const atRisk = [...new Map(churn.map((c) => [c.householdId, c])).values()];
  if (atRisk.length) {
    out.push({
      key: `churn_risk:${fingerprint(atRisk.map((c) => c.householdId))}`,
      kind: 'churn_risk',
      severity: atRisk.length >= 3 ? 'high' : 'medium',
      params: { count: atRisk.length, names: names(atRisk) },
      detail: churn.map(({ householdId: _, ...c }) => c),
      href: '/admin/families',
    });
  }

  if (f.leaving.length) {
    const households = [...new Set(f.leaving.map((l) => l.householdId))];
    out.push({
      key: `leaving:${fingerprint(households)}`,
      kind: 'leaving',
      severity: 'medium',
      params: { count: households.length, names: names(f.leaving) },
      detail: f.leaving.map(({ householdId: _, ...l }) => l),
      href: '/admin/reports/churn',
    });
  }

  const old = f.debts
    .filter((d) => d.oldestDays >= rules.debtAttentionDays)
    .sort((a, b) => b.balanceAgorot - a.balanceAgorot);
  if (old.length) {
    out.push({
      key: `old_debts:${fingerprint(old.map((d) => d.householdId))}`,
      kind: 'old_debts',
      severity: old.length >= 3 ? 'high' : 'medium',
      params: {
        count: old.length,
        amount: old.reduce((n, d) => n + d.balanceAgorot, 0),
        days: rules.debtAttentionDays,
        names: names(old, 3),
      },
      detail: old.map(({ householdId: _, ...d }) => d),
      href: '/admin/money',
    });
  }

  for (const v of f.venues.filter((x) => x.margin < 0)) {
    out.push({
      key: `venue_loss:${v.id}:${v.period}`,
      kind: 'venue_loss',
      severity: 'high',
      params: { venue: v.name, period: v.period, amount: -v.margin },
      detail: [],
      href: '/admin/reports/venues',
    });
  }

  for (const w of f.waitlist.filter((x) => x.count >= rules.waitlistClusterMin)) {
    out.push({
      key: `waitlist_cluster:${fingerprint([w.program, w.venue ?? '', String(w.weekday ?? -1)])}`,
      kind: 'waitlist_cluster',
      severity: 'low',
      params: { program: w.program, venue: w.venue ?? '', day: w.weekday ?? -1, count: w.count },
      detail: [],
      href: '/admin/waitlist',
    });
  }

  if (f.trials.length) {
    out.push({
      key: `trial_followup:${fingerprint(f.trials.map((t) => t.householdId))}`,
      kind: 'trial_followup',
      severity: 'medium',
      params: { count: f.trials.length, names: names(f.trials), days: rules.trialFollowupDays },
      detail: f.trials.map(({ householdId: _, ...t }) => t),
      href: '/admin/trials',
    });
  }

  if (f.uncovered.length) {
    const first = [...f.uncovered].sort((a, b) => (a.date < b.date ? -1 : 1))[0] as {
      date: string;
    };
    out.push({
      key: `uncovered_lessons:${fingerprint(f.uncovered.map((u) => u.sessionId))}`,
      kind: 'uncovered_lessons',
      severity: 'high',
      params: { count: f.uncovered.length, first: first.date },
      detail: f.uncovered.map(({ sessionId: _, ...u }) => u),
      href: '/admin/staff/gaps',
    });
  }

  for (const s of f.staff.filter((x) => x.hours > rules.staffMaxWeeklyHours)) {
    out.push({
      key: `staff_overload:${s.staffId}`,
      kind: 'staff_overload',
      severity: 'medium',
      params: { name: s.name, hours: s.hours, max: rules.staffMaxWeeklyHours },
      detail: [],
      href: `/admin/staff/${s.staffId}`,
    });
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      INSIGHT_KINDS.indexOf(a.kind) - INSIGHT_KINDS.indexOf(b.kind),
  );
}

export interface StoredInsight {
  key: string;
  status: string;
  params: unknown;
  detail: unknown;
  snoozedUntil: string | null;
}

export type InsightChange =
  | { op: 'insert'; insight: Insight }
  | { op: 'update'; insight: Insight; status: InsightStatus; clearNote: boolean }
  | { op: 'resolve'; key: string };

/** JSON with object keys sorted, so a value read back from jsonb (which reorders keys) compares equal. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v !== null && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * Brings the stored feed in line with today's insights: new ones are inserted; ones seen again keep their status (a
 * dismissed one reopens once its snooze date has passed, a resolved one reopens); changed facts clear the AI note;
 * open ones no longer found are resolved.
 */
export function reconcileInsights(
  stored: readonly StoredInsight[],
  found: readonly Insight[],
  asOf: string,
): InsightChange[] {
  const byKey = new Map(stored.map((s) => [s.key, s]));
  const changes: InsightChange[] = [];
  for (const i of found) {
    const s = byKey.get(i.key);
    if (!s) {
      changes.push({ op: 'insert', insight: i });
      continue;
    }
    const status: InsightStatus =
      s.status === 'dismissed' && (s.snoozedUntil === null || s.snoozedUntil >= asOf)
        ? 'dismissed'
        : 'open';
    changes.push({
      op: 'update',
      insight: i,
      status,
      clearNote: !same(s.params, i.params) || !same(s.detail, i.detail),
    });
  }
  const seen = new Set(found.map((i) => i.key));
  for (const s of stored) {
    if (s.status === 'open' && !seen.has(s.key)) changes.push({ op: 'resolve', key: s.key });
  }
  return changes;
}

/** Insights as digest items: the kinds the digest does not already cover on its own. */
export function insightDigestItems(insights: readonly Insight[]): DigestItem[] {
  const own: readonly InsightKind[] = ['old_debts', 'venue_loss', 'waitlist_cluster'];
  return insights
    .filter((i) => !own.includes(i.kind))
    .map((i) => ({
      section: i.severity === 'low' ? 'suggestion' : 'attention',
      code: `insights.kinds.${i.kind}.title`,
      params: i.params,
    }));
}
