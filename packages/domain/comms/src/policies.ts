/**
 * Pure communication rules (brief §6.12, docs/POLICIES.md §12): when a message may go out (quiet hours, Shabbat and
 * Yom Tov), how a template is filled, whether a queued message is blocked, what a family's WhatsApp message is about
 * (a deterministic Hebrew classifier), what the inbox does with it, when the holiday notice is due and who a broadcast
 * reaches. Every decision carries an i18n code; nothing here talks to the database or the network.
 */
import {
  addDays,
  DEFAULT_CALENDAR_POLICY,
  lessonDay,
  restWindow,
  todayInIsrael,
  type CalendarOverride,
  type CalendarPolicy,
  type LocalDate,
} from '@rswim/calendar';
import type {
  BlockReason,
  Classification,
  HoldReason,
  InboundIntent,
  PolicyRules,
  Segment,
  TriageActionKind,
} from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `comms.decision.${code}`,
  params,
});

// ─── Rules with defaults ────────────────────────────────────────────────────

export interface CommsRules {
  quietStart: string;
  quietEnd: string;
  blockRest: boolean;
  ratePerMinute: number;
  holidayNoticeDaysBefore: number;
  aiTriage: boolean;
  minConfidence: number;
  botEnabled: boolean;
}

/** The comms part of resolved PolicyRules, with the documented defaults (docs/POLICIES.md §12). */
export function commsRulesFrom(rules: PolicyRules): CommsRules {
  const c = rules.comms ?? {};
  return {
    quietStart: c.quiet_hours_start ?? '21:30',
    quietEnd: c.quiet_hours_end ?? '08:00',
    blockRest: c.block_shabbat_and_chag ?? true,
    ratePerMinute: c.rate_per_minute ?? 20,
    holidayNoticeDaysBefore: c.holiday_notice_days_before ?? 2,
    aiTriage: c.ai_triage ?? false,
    minConfidence: c.triage_min_confidence_pct ?? 80,
    botEnabled: c.bot_enabled ?? false,
  };
}

// ─── Send window ────────────────────────────────────────────────────────────

const MINUTE = 60_000;

/** "HH:MM" on the wall clock in Israel at an instant. */
export function israelClock(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** The instant a local Israel date and wall-clock time ("HH:MM") name. */
export function israelInstant(date: LocalDate, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  // Two passes settle the offset on either side of a daylight-saving change.
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMs(new Date(guess));
  return new Date(guess);
}

function offsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return asUtc - Math.floor(instant.getTime() / MINUTE) * MINUTE;
}

export type SendDecision =
  | { action: 'send'; explanation: Explanation }
  | { action: 'hold'; until: Date; reason: HoldReason; explanation: Explanation };

/** The rest window (Shabbat or Yom Tov, padded) an instant falls in, if any. */
export function restWindowAt(instant: Date): { start: Date; end: Date } | null {
  const local = todayInIsrael(instant);
  for (const d of [addDays(local, -1), local]) {
    const w = restWindow(d);
    if (w && instant >= w.start && instant <= w.end) return w;
  }
  return null;
}

function quietUntil(instant: Date, start: string, end: string): Date | null {
  if (start === end) return null;
  const t = israelClock(instant);
  const date = todayInIsrael(instant);
  if (start < end) return t >= start && t < end ? israelInstant(date, end) : null;
  if (t >= start) return israelInstant(addDays(date, 1), end);
  return t < end ? israelInstant(date, end) : null;
}

/**
 * May a message go out at `instant`? If not, until when it waits and why. Checked again at send time, so a message
 * queued before Shabbat and still unsent at candle lighting is held, never sent.
 */
export function sendDecision(instant: Date, rules: CommsRules): SendDecision {
  let at = instant;
  let reason: HoldReason | null = null;
  // A rest window can end inside quiet hours (a summer havdalah) and quiet hours can end inside nothing else, so two
  // rounds always settle; the loop bound is a guard.
  for (let i = 0; i < 4; i++) {
    const rest = rules.blockRest ? restWindowAt(at) : null;
    if (rest) {
      at = new Date(rest.end.getTime() + MINUTE);
      reason ??= 'rest_window';
      continue;
    }
    const quiet = quietUntil(at, rules.quietStart, rules.quietEnd);
    if (quiet) {
      at = quiet;
      reason ??= 'quiet_hours';
      continue;
    }
    break;
  }
  if (!reason) return { action: 'send', explanation: explain('send') };
  return {
    action: 'hold',
    until: at,
    reason,
    explanation: explain(`hold.${reason}`, { until: at.toISOString() }),
  };
}

// ─── Templates and blocking ─────────────────────────────────────────────────

const VARIABLE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** The variable names a template body uses, in order of first use. */
export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VARIABLE)].map((m) => m[1] as string))];
}

export type RenderResult = { ok: true; text: string } | { ok: false; missing: string[] };

/** Fills `{{ name }}` placeholders. A missing or empty variable fails the whole render: nothing goes out half-filled. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): RenderResult {
  const missing = templateVariables(body).filter((v) => vars[v] == null || vars[v] === '');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, text: body.replace(VARIABLE, (_, name: string) => String(vars[name])) };
}

export interface OutboundFacts {
  optedIn: boolean;
  phoneE164: string | null;
  templateActive: boolean;
  render: RenderResult;
}

export type EnqueueDecision =
  | { status: 'queued'; text: string; explanation: Explanation }
  | { status: 'blocked'; reason: BlockReason; text: string | null; explanation: Explanation };

/** Whether a message is queued or blocked, and why. A blocked message is still logged with its reason. */
export function enqueueDecision(f: OutboundFacts): EnqueueDecision {
  const text = f.render.ok ? f.render.text : null;
  const block = (reason: BlockReason, params: Record<string, string> = {}): EnqueueDecision => ({
    status: 'blocked',
    reason,
    text,
    explanation: explain(`blocked.${reason}`, params),
  });
  if (!f.templateActive) return block('template_inactive');
  if (!f.optedIn) return block('opted_out');
  if (!f.phoneE164) return block('no_phone');
  if (!f.render.ok) return block('missing_variable', { missing: f.render.missing.join(', ') });
  return { status: 'queued', text: f.render.text, explanation: explain('queued') };
}

// ─── Inbound classification (rules-v1) ──────────────────────────────────────

export const RULES_CLASSIFIER = 'rules-v1';

export interface ClassifyContext {
  /** The household's students (empty when the sender is unknown). */
  students: { id: string; firstName: string }[];
  today: LocalDate;
  /** The phone matched a guardian. */
  known: boolean;
  /** The phone matched a staff member. */
  isStaff?: boolean;
}

/** Intent patterns in priority order: the first that matches is the intent. */
const INTENT_PATTERNS: [InboundIntent, RegExp][] = [
  ['complaint', /תלונה|לא מרוצ|מאוכזב|לא מקובל|חוצפה|כועס|פגע ב|זלזול/],
  [
    'cancellation_request',
    /לבטל את ה(מנוי|רישום|הרשמה|הוראת קבע)|ביטול (ה)?(מנוי|רישום|הרשמה|הוראת קבע)|לעזוב את ה|להפסיק (את )?(ה)?(שיעורים|חוג|מנוי)|מפסיק(ה|ים)? (את )?(ה)?(שיעורים|חוג)/,
  ],
  ['freeze_request', /להקפיא|הקפאה|הקפאת/],
  [
    'absence_notice',
    /לא (י|ת|נ|א)(גיע|בוא)|לא (י|ת|נ)וכל(ו)? להגיע|חול(ה|ים|ות)|נעדר|(י|ת)חסר|לבטל (את )?(ה)?שיעור|מבטל(ת|ים)? (את )?(ה)?שיעור|ביטול שיעור|לא נוכל להגיע/,
  ],
  ['makeup_request', /השלמה|השלמות|להשלים/],
  ['receipt_request', /קבלה|קבלות|חשבונית/],
  ['payment_question', /תשלום|לשלם|חיוב|חויב|הוראת קבע|אשראי|זיכוי|יתרה/],
  [
    'schedule_question',
    /מתי|באיזו שעה|איזו שעה|באיזה יום|מה השעה|מערכת שעות|יש שיעור|יהיה שיעור|איפה/,
  ],
  ['lead', /מעוניי?נ|להירשם|הרשמה|ניסיון|פרטים|כמה עולה|מחיר|יש מקום/],
];

const HEBREW_PREFIXES = 'ושהלבכמ';
const NIQQUD = /[֑-ׇ]/g;

function words(text: string): string[] {
  return text
    .replace(NIQQUD, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function nameMatches(word: string, name: string): boolean {
  if (word === name) return true;
  // Up to two prefix letters ("ולדניאל" is rare, "שדניאל" and "ודניאל" are common).
  for (let i = 1; i <= 2 && i < word.length; i++) {
    const head = word.slice(0, i);
    if ([...head].every((c) => HEBREW_PREFIXES.includes(c)) && word.slice(i) === name) return true;
  }
  return false;
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function weekday(date: LocalDate): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The local date a message names, relative to `today`, or null. */
export function mentionedDate(text: string, today: LocalDate): LocalDate | null {
  if (/מחרתיים/.test(text)) return addDays(today, 2);
  if (/מחר/.test(text)) return addDays(today, 1);
  if (/היום|הערב|עכשיו/.test(text)) return today;
  const day = /יום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/.exec(text);
  if (day) {
    const target = WEEKDAYS.indexOf(day[1] as string);
    return addDays(today, (target - weekday(today) + 7) % 7);
  }
  const dm = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\b/.exec(text);
  if (dm) {
    const [d, m] = [Number(dm[1]), Number(dm[2])];
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    const build = (yy: number) =>
      `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const probe = new Date(`${build(y)}T12:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== d) return null;
    // Without a year, a date well behind us is next year's ("3.1" said in December).
    if (!dm[3] && build(y) < addDays(today, -60)) y += 1;
    return build(y);
  }
  return null;
}

/** A deterministic Hebrew classifier: the baseline, and the fallback when the AI classifier is off or fails. */
export function classifyInbound(text: string, ctx: ClassifyContext): Classification {
  const clean = text.replace(NIQQUD, '');
  const signals: string[] = [];
  const hits = INTENT_PATTERNS.filter(([, re]) => re.test(clean)).map(([intent]) => intent);

  let intent: InboundIntent = hits[0] ?? 'personal_other';
  if (ctx.isStaff && intent !== 'complaint') intent = 'instructor_message';
  else if (!ctx.known && (intent === 'schedule_question' || intent === 'payment_question'))
    intent = 'lead';
  if (hits.length > 0) signals.push(`intent:${hits.join('+')}`);

  const tokens = words(clean);
  const students = ctx.students.filter((s) => {
    const name = s.firstName.replace(NIQQUD, '').toLowerCase();
    return tokens.some((w) => nameMatches(w, name));
  });
  let studentIds = students.map((s) => s.id);
  if (studentIds.length > 0) signals.push('student:named');
  else if (ctx.students.length === 1 && ctx.known) {
    studentIds = ctx.students.map((s) => s.id);
    signals.push('student:only_child');
  }
  const date = mentionedDate(clean, ctx.today);
  if (date) signals.push(`date:${date}`);

  let confidence = 0;
  if (intent === 'instructor_message') confidence = 70;
  else if (hits.length > 0) {
    confidence = 60;
    if (signals.includes('student:named')) confidence += 20;
    else if (signals.includes('student:only_child')) confidence += 10;
    if (date) confidence += 20;
    // Two unrelated asks in one message ("absent today, and the receipt?") are less certain.
    if (hits.filter((h) => !(h === 'makeup_request' && hits[0] === 'absence_notice')).length > 1) {
      confidence -= 15;
      signals.push('mixed');
    }
  } else confidence = 50;

  return {
    intent,
    confidence: Math.max(0, Math.min(100, confidence)),
    studentIds,
    date,
    classifier: RULES_CLASSIFIER,
    signals,
  };
}

// ─── Triage ─────────────────────────────────────────────────────────────────

export type TriageDecision =
  | { route: 'action'; kind: TriageActionKind; explanation: Explanation }
  | { route: 'human'; explanation: Explanation }
  | { route: 'review'; explanation: Explanation };

const ACTION_INTENTS: Partial<Record<InboundIntent, TriageActionKind>> = {
  absence_notice: 'absence_notice',
  makeup_request: 'makeup_request',
  freeze_request: 'freeze_request',
  receipt_request: 'receipt_request',
};
const NEEDS_STUDENT = new Set<InboundIntent>([
  'absence_notice',
  'makeup_request',
  'freeze_request',
]);

/**
 * What the inbox does with a classified message. Complaints and cancellations always go to a person; a confident,
 * complete request becomes a draft action approved with one tap; everything else waits in the inbox. Nothing here
 * ever answers a family automatically, least of all personal messages.
 */
export function triageDecision(c: Classification, rules: CommsRules): TriageDecision {
  if (c.intent === 'complaint' || c.intent === 'cancellation_request') {
    return { route: 'human', explanation: explain(`triage.always_human.${c.intent}`) };
  }
  const kind = ACTION_INTENTS[c.intent];
  if (!kind) return { route: 'review', explanation: explain(`triage.review.${c.intent}`) };
  if (c.confidence < rules.minConfidence) {
    return {
      route: 'human',
      explanation: explain('triage.low_confidence', {
        confidence: c.confidence,
        min: rules.minConfidence,
      }),
    };
  }
  if (NEEDS_STUDENT.has(c.intent) && c.studentIds.length === 0) {
    return { route: 'human', explanation: explain('triage.no_student') };
  }
  return { route: 'action', kind, explanation: explain(`triage.action.${kind}`) };
}

// ─── Holiday notice ─────────────────────────────────────────────────────────

export interface HolidayStretch {
  start: LocalDate;
  end: LocalDate;
  resumeOn: LocalDate;
}

const isHoliday = (
  date: LocalDate,
  policy: CalendarPolicy,
  overrides: readonly CalendarOverride[],
) =>
  lessonDay(date, policy, overrides).reasons.some(
    (r) => r !== 'shabbat' && r !== 'override_closed',
  );

/**
 * The next run of days without lessons because of a holiday (not a plain Shabbat, not a school closure) that starts
 * within `daysBefore` days after `today`. The worker sends one notice per stretch, keyed by its start.
 */
export function holidayNotice(
  today: LocalDate,
  daysBefore: number,
  policy: CalendarPolicy = DEFAULT_CALENDAR_POLICY,
  overrides: readonly CalendarOverride[] = [],
): HolidayStretch | null {
  for (let d = 1; d <= daysBefore; d++) {
    const start = addDays(today, d);
    if (!isHoliday(start, policy, overrides) || isHoliday(addDays(start, -1), policy, overrides))
      continue;
    let end = start;
    while (!lessonDay(addDays(end, 1), policy, overrides).lessons) end = addDays(end, 1);
    return { start, end, resumeOn: addDays(end, 1) };
  }
  return null;
}

// ─── Segments ───────────────────────────────────────────────────────────────

export interface SegmentFacts {
  venueIds: readonly string[];
  groupIds: readonly string[];
  programIds: readonly string[];
  owing: boolean;
}

/** Every filter the segment sets must match; an empty filter matches everyone. */
export function matchesSegment(r: SegmentFacts, s: Segment): boolean {
  const any = (want: readonly string[], have: readonly string[]) =>
    want.length === 0 || want.some((id) => have.includes(id));
  return (
    any(s.venueIds, r.venueIds) &&
    any(s.groupIds, r.groupIds) &&
    any(s.programIds, r.programIds) &&
    (!s.owing || r.owing)
  );
}

// ─── Words for dates ────────────────────────────────────────────────────────

/** "יום רביעי 7.10" / "Wednesday 7.10": how a message names a day. */
export function messageDate(date: LocalDate, locale: 'he' | 'en'): string {
  const weekdayName = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  const [, m, d] = date.split('-');
  return `${weekdayName} ${Number(d)}.${Number(m)}`;
}

/** "2026-10" → "10/2026". */
export function messagePeriod(period: string): string {
  const [y, m] = period.split('-');
  return `${m}/${y}`;
}

/** "YYYY-MM-DDTHH:MM" on the wall clock in Israel (how forms and the absence service take a time). */
export function israelLocalDateTime(instant: Date): string {
  return `${todayInIsrael(instant)}T${israelClock(instant)}`;
}

/** "יום שלישי" / "Tuesday" for a weekday number (0 = Sunday). */
export function weekdayWord(weekday: number, locale: 'he' | 'en'): string {
  // 2026-10-04 is a Sunday.
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 9, 4 + weekday, 12)));
}

/** One child's venue move, as the family's message tells it. */
export interface MigrationNoticeFacts {
  firstName: string;
  from: { group: string; venue: string; weekday: number; time: string };
  to: { group: string; venue: string; weekday: number; time: string };
  effectiveOn: LocalDate;
  price:
    | { kind: 'same'; before: number; after: number }
    | { kind: 'up' | 'down'; before: number; after: number; delta: number }
    | { kind: 'unknown' };
}

const shekels = (agorot: number) => `₪${(agorot / 100).toLocaleString('en-US')}`;

/** The variables of the `venue_migration` and `venue_migration_reverted` templates for one child. */
export function migrationNoticeVars(
  n: MigrationNoticeFacts,
  locale: 'he' | 'en',
): Record<string, string> {
  const he = locale === 'he';
  const price =
    n.price.kind === 'unknown'
      ? he
        ? 'נעדכן לגבי המחיר בהמשך.'
        : 'We will update you about the price.'
      : n.price.kind === 'same'
        ? he
          ? 'המחיר החודשי לא משתנה.'
          : 'The monthly price stays the same.'
        : he
          ? `המחיר החודשי יהיה ${shekels(n.price.after)} במקום ${shekels(n.price.before)}.`
          : `The monthly price will be ${shekels(n.price.after)} instead of ${shekels(n.price.before)}.`;
  return {
    student_name: n.firstName,
    from_group: n.from.group,
    from_venue: n.from.venue,
    from_day: weekdayWord(n.from.weekday, locale),
    from_time: n.from.time,
    to_group: n.to.group,
    to_venue: n.to.venue,
    to_day: weekdayWord(n.to.weekday, locale),
    to_time: n.to.time,
    date: messageDate(n.effectiveOn, locale),
    price_note: price,
  };
}
