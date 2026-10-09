/**
 * The freediving club's rules as pure functions: the sea call, how deep a diver may go today, whether a diver is
 * ready to get in the water, whether a booking is allowed, instructor ratios, pass balances, the instructor's line
 * plan and the owner's advisory insights. Each takes the resolved rules (dive_rule_sets) and explains itself.
 */
import type { DiveLevel, DiveProgramKind, ResolvedDiveRules, SeaCall } from '@rswim/contracts';

export interface Reason {
  code: string;
  params?: Record<string, string | number>;
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export type ExpiryState = 'ok' | 'warn' | 'expired' | 'missing';

/** A document or certificate that runs out on `expiresOn`: fine, running out within `warnDays`, out, or never given. */
export function expiryState(
  expiresOn: string | null,
  today: string,
  warnDays: number,
): ExpiryState {
  if (!expiresOn) return 'missing';
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'expired';
  return left <= warnDays ? 'warn' : 'ok';
}

// ─── The sea call ───────────────────────────────────────────────────────────

export interface SeaObservation {
  windKts: number;
  waveCm: number;
  visibilityM: number;
  current: 'none' | 'light' | 'strong';
}

/** Go, caution or no-go for the morning, with every reason that pushed it there. */
export function seaCall(
  obs: SeaObservation,
  rules: ResolvedDiveRules['sea'],
): { call: SeaCall; reasons: Reason[] } {
  const noGo: Reason[] = [];
  const caution: Reason[] = [];
  if (obs.windKts > rules.max_wind_kts)
    noGo.push({ code: 'wind', params: { kts: obs.windKts, max: rules.max_wind_kts } });
  else if (obs.windKts > rules.caution_wind_kts)
    caution.push({ code: 'wind', params: { kts: obs.windKts, max: rules.caution_wind_kts } });
  if (obs.waveCm > rules.max_wave_cm)
    noGo.push({ code: 'waves', params: { cm: obs.waveCm, max: rules.max_wave_cm } });
  else if (obs.waveCm > rules.caution_wave_cm)
    caution.push({ code: 'waves', params: { cm: obs.waveCm, max: rules.caution_wave_cm } });
  if (obs.visibilityM < rules.min_visibility_m)
    caution.push({
      code: 'visibility',
      params: { m: obs.visibilityM, min: rules.min_visibility_m },
    });
  if (obs.current === 'strong') {
    if (rules.strong_current_no_go) noGo.push({ code: 'current' });
    else caution.push({ code: 'current' });
  }
  if (noGo.length > 0) return { call: 'no_go', reasons: [...noGo, ...caution] };
  if (caution.length > 0) return { call: 'caution', reasons: caution };
  return { call: 'go', reasons: [] };
}

// ─── Depth ──────────────────────────────────────────────────────────────────

export interface DiverDepthFacts {
  certLevel: number;
  pbCwtM: number | null;
  depthLimitM: number | null;
}

/**
 * How deep a diver may target today: the shallowest of their level's ceiling, their best plus one progression step,
 * an instructor's personal limit and the site's depth. Says which one decided.
 */
export function allowedDepth(
  diver: DiverDepthFacts,
  rules: ResolvedDiveRules['depth'],
  siteMaxM?: number,
): { maxM: number; limitedBy: 'level' | 'progression' | 'instructor' | 'site' } {
  const level = Math.max(0, Math.min(5, diver.certLevel)) as DiveLevel;
  const candidates: { maxM: number; limitedBy: 'level' | 'progression' | 'instructor' | 'site' }[] =
    [{ maxM: rules.level_max_m[level] ?? 0, limitedBy: 'level' }];
  if (diver.pbCwtM !== null)
    candidates.push({ maxM: diver.pbCwtM + rules.progression_step_m, limitedBy: 'progression' });
  if (diver.depthLimitM !== null)
    candidates.push({ maxM: diver.depthLimitM, limitedBy: 'instructor' });
  if (siteMaxM !== undefined) candidates.push({ maxM: siteMaxM, limitedBy: 'site' });
  return candidates.reduce((a, b) => (b.maxM < a.maxM ? b : a));
}

// ─── Readiness ──────────────────────────────────────────────────────────────

export interface ReadinessFacts {
  waiverSignedOn: string | null;
  medicalExpiresOn: string | null;
  certLevel: number;
  /** Paid for this session, or holds a pass that covers it. */
  paid: boolean;
}

export type ReadinessKey = 'waiver' | 'medical' | 'level' | 'payment';
export interface ReadinessItem {
  key: ReadinessKey;
  state: 'ok' | 'warn' | 'missing';
  params?: Record<string, string | number>;
}

/** The four things the front desk checks before a diver gets in the water on `onDate`. */
export function readiness(
  facts: ReadinessFacts,
  session: { onDate: string; minLevel: number },
  rules: ResolvedDiveRules['paperwork'],
): { ready: boolean; items: ReadinessItem[] } {
  const items: ReadinessItem[] = [];
  const waiverUntil = facts.waiverSignedOn
    ? addMonths(facts.waiverSignedOn, rules.waiver_valid_months)
    : null;
  const waiver = expiryState(waiverUntil, session.onDate, 0);
  items.push({ key: 'waiver', state: waiver === 'ok' || waiver === 'warn' ? 'ok' : 'missing' });

  const medical = expiryState(facts.medicalExpiresOn, session.onDate, rules.medical_warn_days);
  items.push(
    medical === 'warn'
      ? {
          key: 'medical',
          state: 'warn',
          params: { days: daysBetween(session.onDate, facts.medicalExpiresOn as string) },
        }
      : { key: 'medical', state: medical === 'ok' ? 'ok' : 'missing' },
  );
  items.push({
    key: 'level',
    state: facts.certLevel >= session.minLevel ? 'ok' : 'missing',
    params: { need: session.minLevel, has: facts.certLevel },
  });
  items.push({ key: 'payment', state: facts.paid ? 'ok' : 'missing' });
  return { ready: items.every((i) => i.state !== 'missing'), items };
}

// ─── Booking ────────────────────────────────────────────────────────────────

export interface BookingFacts {
  capacity: number;
  booked: number;
  status: string;
  startsAt: Date;
  minLevel: number;
  diverLevel: number;
  alreadyBooked: boolean;
}

/** Whether a diver may book a session now; the first rule that refuses explains why. */
export function bookingDecision(
  f: BookingFacts,
  now: Date,
): { ok: true } | { ok: false; code: string } {
  if (f.status === 'cancelled') return { ok: false, code: 'sessionCancelled' };
  if (f.startsAt.getTime() <= now.getTime()) return { ok: false, code: 'sessionPast' };
  if (f.alreadyBooked) return { ok: false, code: 'alreadyBooked' };
  if (f.diverLevel < f.minLevel) return { ok: false, code: 'levelTooLow' };
  if (f.booked >= f.capacity) return { ok: false, code: 'sessionFull' };
  return { ok: true };
}

// ─── Ratio ──────────────────────────────────────────────────────────────────

/** Instructors a session needs in the water for its divers, and whether it has them. */
export function ratioCheck(
  kind: DiveProgramKind,
  divers: number,
  instructors: number,
  rules: ResolvedDiveRules['ratio'],
): { needed: number; ok: boolean; perInstructor: number } {
  const perInstructor = rules[kind];
  const needed = divers === 0 ? 0 : Math.ceil(divers / perInstructor);
  return { needed, ok: instructors >= needed, perInstructor };
}

// ─── Passes ─────────────────────────────────────────────────────────────────

export interface PassFacts {
  sessionsTotal: number | null;
  validUntil: string;
  used: number;
}

/** What is left on a pass: sessions (null = unlimited), days, and whether it still covers a session today. */
export function passBalance(
  pass: PassFacts,
  today: string,
): { remaining: number | null; daysLeft: number; usable: boolean } {
  const daysLeft = daysBetween(today, pass.validUntil);
  const remaining =
    pass.sessionsTotal === null ? null : Math.max(0, pass.sessionsTotal - pass.used);
  return { remaining, daysLeft, usable: daysLeft >= 0 && (remaining === null || remaining > 0) };
}

// ─── The instructor's line plan ─────────────────────────────────────────────

export interface LineDiver {
  id: string;
  targetM: number;
}

/**
 * Splits a session's divers across buoy lines by target depth (deepest first on line A), at most `perLine` on a
 * line, and pairs buddies with the closest target on the same line (one-up, one-down).
 */
export function planLines(
  divers: readonly LineDiver[],
  perLine: number,
): { line: string; divers: { id: string; targetM: number; buddyId: string | null }[] }[] {
  const sorted = [...divers].sort((a, b) => b.targetM - a.targetM || a.id.localeCompare(b.id));
  const size = Math.max(2, perLine);
  const lines: {
    line: string;
    divers: { id: string; targetM: number; buddyId: string | null }[];
  }[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size);
    lines.push({
      line: String.fromCharCode(65 + lines.length),
      divers: chunk.map((d, j) => {
        const pair = j % 2 === 0 ? chunk[j + 1] : chunk[j - 1];
        return { id: d.id, targetM: d.targetM, buddyId: pair?.id ?? null };
      }),
    });
  }
  return lines;
}

// ─── The owner's insights ───────────────────────────────────────────────────

export interface ClubFacts {
  today: string;
  /** Forecast days with a no-go or caution call and how many divers are booked in the sea that day. */
  forecast: { date: string; call: SeaCall; windKts: number; seaBookings: number }[];
  /** Upcoming courses and their fill. */
  courses: { title: string; date: string; booked: number; capacity: number }[];
  medicalsExpiring: number;
  staffCertsExpiring: { name: string; title: string; days: number }[];
  gearServiceDue: number;
  rentalsOverdue: number;
  leadsWaiting: number;
  daysSinceIncident: number | null;
  /** Divers who finished a course in the last 90 days and have not dived since. */
  graduatesIdle: number;
}

export interface Insight {
  kind:
    | 'weather'
    | 'course_fill'
    | 'medicals'
    | 'staff_cert'
    | 'gear_service'
    | 'rentals_overdue'
    | 'leads'
    | 'safety_streak'
    | 'graduates';
  severity: 'info' | 'attention' | 'urgent';
  params: Record<string, string | number>;
}

const SEVERITY_ORDER = { urgent: 0, attention: 1, info: 2 } as const;

/** Advisory notes for the owner's bridge, most urgent first. Nothing here changes data. */
export function clubInsights(f: ClubFacts): Insight[] {
  const out: Insight[] = [];
  for (const day of f.forecast) {
    if (day.call === 'go' || day.seaBookings === 0) continue;
    out.push({
      kind: 'weather',
      severity: day.call === 'no_go' ? 'urgent' : 'attention',
      params: { date: day.date, kts: day.windKts, divers: day.seaBookings, call: day.call },
    });
  }
  for (const c of f.courses) {
    const left = daysBetween(f.today, c.date);
    if (left <= 21 && c.booked / c.capacity < 0.5)
      out.push({
        kind: 'course_fill',
        severity: left <= 7 ? 'urgent' : 'attention',
        params: { title: c.title, date: c.date, booked: c.booked, capacity: c.capacity },
      });
  }
  if (f.medicalsExpiring > 0)
    out.push({ kind: 'medicals', severity: 'attention', params: { count: f.medicalsExpiring } });
  for (const s of f.staffCertsExpiring)
    out.push({
      kind: 'staff_cert',
      severity: s.days < 0 ? 'urgent' : 'attention',
      params: { name: s.name, title: s.title, days: s.days },
    });
  if (f.rentalsOverdue > 0)
    out.push({
      kind: 'rentals_overdue',
      severity: 'attention',
      params: { count: f.rentalsOverdue },
    });
  if (f.leadsWaiting > 0)
    out.push({ kind: 'leads', severity: 'attention', params: { count: f.leadsWaiting } });
  if (f.gearServiceDue > 0)
    out.push({ kind: 'gear_service', severity: 'info', params: { count: f.gearServiceDue } });
  if (f.graduatesIdle > 0)
    out.push({ kind: 'graduates', severity: 'info', params: { count: f.graduatesIdle } });
  if (f.daysSinceIncident !== null && f.daysSinceIncident >= 14)
    out.push({ kind: 'safety_streak', severity: 'info', params: { days: f.daysSinceIncident } });
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
