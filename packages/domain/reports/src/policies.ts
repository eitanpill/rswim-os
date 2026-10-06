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
  type DigestSection,
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
export function buildDigest(f: DigestFacts, rules: DigestRules): DigestItem[] {
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
  if (!items.some((i) => i.section === 'attention')) items.push(item('attention', 'allClear'));
  return items;
}
