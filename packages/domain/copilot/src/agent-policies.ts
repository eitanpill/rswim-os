/**
 * Pure rules of the business brain (docs/AI-BRAIN.md, docs/POLICIES.md §20): the level each kind of action runs at,
 * and the gate every action passes before anything changes. The model only fills in an action; this decides whether it
 * runs now, waits for the owner, or is refused.
 */
import {
  AGENT_ACTION_KINDS,
  AGENT_KIND_CEILING,
  AGENT_PROFILE_LEVELS,
  AUTONOMY_LEVELS,
  type AgentActionKind,
  type AgentProfile,
  type AutonomyLevel,
} from '@rswim/contracts';

const rank = (l: AutonomyLevel) => AUTONOMY_LEVELS.indexOf(l);

/** The lower of two levels. */
export function capLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return rank(a) <= rank(b) ? a : b;
}

export interface AgentSettingsView {
  profile: AgentProfile;
  levels: Partial<Record<AgentActionKind, AutonomyLevel>>;
  maxAutoPerDay: number;
  maxAutoPaymentAgorot: number;
  paused: boolean;
}

/** The level of every kind: what the owner set, else the profile's, never above the kind's ceiling. */
export function effectiveLevels(s: AgentSettingsView): Record<AgentActionKind, AutonomyLevel> {
  return Object.fromEntries(
    AGENT_ACTION_KINDS.map((k) => [
      k,
      capLevel(s.levels[k] ?? AGENT_PROFILE_LEVELS[s.profile][k], AGENT_KIND_CEILING[k]),
    ]),
  ) as Record<AgentActionKind, AutonomyLevel>;
}

/** The profile whose table matches the levels exactly, or null when the owner changed rows ("custom"). */
export function matchingProfile(s: AgentSettingsView): AgentProfile | null {
  const levels = effectiveLevels(s);
  const base = effectiveLevels({ ...s, levels: {} });
  return AGENT_ACTION_KINDS.every((k) => levels[k] === base[k]) ? s.profile : null;
}

/** A level the owner asked for above a kind's ceiling is refused, not lowered silently. */
export function levelsWithinCeiling(levels: Partial<Record<AgentActionKind, AutonomyLevel>>): {
  ok: boolean;
  kind?: AgentActionKind;
} {
  for (const k of AGENT_ACTION_KINDS) {
    const l = levels[k];
    if (l && rank(l) > rank(AGENT_KIND_CEILING[k])) return { ok: false, kind: k };
  }
  return { ok: true };
}

// ─── The gate ───────────────────────────────────────────────────────────────

export type WaitReason = 'level' | 'paused' | 'daily_cap' | 'amount_cap';

export type GateDecision =
  { route: 'refuse'; code: string } | { route: 'wait'; reason: WaitReason } | { route: 'run' };

export interface GateFacts {
  level: AutonomyLevel;
  paused: boolean;
  /** Actions that already ran on their own today (Asia/Jerusalem). */
  ranAloneToday: number;
  maxAutoPerDay: number;
  /** The money the action asks for, when it asks for money. */
  amountAgorot: number | null;
  maxAutoPaymentAgorot: number;
}

/**
 * off → refused; suggest and approve → waits for the owner; auto → runs, unless the brain is paused, today's quota of
 * actions on its own is used up, or the amount is above the owner's cap (then it waits, never refused).
 */
export function agentGate(f: GateFacts): GateDecision {
  if (f.level === 'off') return { route: 'refuse', code: 'agent.errors.off' };
  if (f.level !== 'auto') return { route: 'wait', reason: 'level' };
  if (f.paused) return { route: 'wait', reason: 'paused' };
  if (f.ranAloneToday >= f.maxAutoPerDay) return { route: 'wait', reason: 'daily_cap' };
  if (f.amountAgorot !== null && f.amountAgorot > f.maxAutoPaymentAgorot)
    return { route: 'wait', reason: 'amount_cap' };
  return { route: 'run' };
}

/**
 * Kinds whose effect the journal can take back with one tap. A message that went out cannot be unsent, an absence
 * already decided the child's makeup credit (the office voids a credit on the child's page), and cancelled lessons
 * already told the families and gave credits (the closure screen handles what follows). A substitute search is
 * withdrawn while nobody took the lesson yet.
 */
const UNDOABLE: ReadonlySet<AgentActionKind> = new Set([
  'move_student',
  'open_makeup_slots',
  'payment_link',
  'book_makeup',
  'freeze',
  'substitute',
]);

export function undoable(kind: AgentActionKind): boolean {
  return UNDOABLE.has(kind);
}

// ─── WhatsApp: the owner's approvals and the staff's requests ───────────────

type Locale = 'he' | 'en';

/** The same sentences the brain's screens show (copilot.summary.*), for WhatsApp, where the web's messages are not. */
const SUMMARY_TEXT: Record<Locale, Record<string, string>> = {
  he: {
    move: 'להעביר את {student} מ{from} ל{to}, החל מ-{date}',
    add: 'לשבץ את {student} ב{to}, החל מ-{date}',
    message: 'לשלוח למשפחת {family}: "{text}"',
    slots: 'לפתוח השלמות עם {staff} ב{venue}, {date} {from}-{to} ({capacity} ילדים)',
    payment: 'לשלוח למשפחת {family} קישור תשלום על {amount} ({description})',
    absence: 'לרשום ש{student} לא מגיע/ה ל{group} ב-{date} {time}',
    makeup: 'לקבוע ל{student} השלמה ב{group}, {date} {time}',
    freeze: 'להקפיא את המקום של {student} ב{group} מ-{date} עד {until}',
    cancelLessons: 'לבטל את השיעורים ב{venue} מ-{date} עד {until} ({sessions} שיעורים, {reason})',
    cancelLessonsAll: 'לבטל את כל השיעורים מ-{date} עד {until} ({sessions} שיעורים, {reason})',
    substitute: 'למצוא מחליף ל{staff} בשיעור {group}, {date} {time}',
    substituteOpen: 'למצוא מדריך/ה לשיעור {group}, {date} {time}',
  },
  en: {
    move: 'Move {student} from {from} to {to}, from {date}',
    add: 'Place {student} in {to}, from {date}',
    message: 'Message the {family} family: "{text}"',
    slots: 'Open makeup slots with {staff} at {venue}, {date} {from}-{to} ({capacity} children)',
    payment: 'Send the {family} family a payment link for {amount} ({description})',
    absence: 'Record that {student} misses {group} on {date} {time}',
    makeup: 'Book a makeup for {student} in {group}, {date} {time}',
    freeze: "Freeze {student}'s place in {group} from {date} to {until}",
    cancelLessons:
      'Cancel the lessons at {venue} from {date} to {until} ({sessions} lessons, {reason})',
    cancelLessonsAll: 'Cancel all lessons from {date} to {until} ({sessions} lessons, {reason})',
    substitute: 'Find a substitute for {staff} in {group}, {date} {time}',
    substituteOpen: 'Find an instructor for {group}, {date} {time}',
  },
};

const dmy = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d);

/** A summary as one sentence: dates as DD/MM/YYYY, amounts (agorot) in shekels. */
export function summaryText(
  s: { code: string; params: Record<string, string | number> },
  locale: Locale,
): string {
  const key = s.code.replace(/^copilot\.summary\./, '');
  const template = SUMMARY_TEXT[locale][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = s.params[name];
    if (v === undefined) return '';
    if (name === 'amount') return `₪${(Number(v) / 100).toLocaleString('en-US')}`;
    if (name === 'date' || name === 'until') return dmy(String(v));
    return String(v);
  });
}

/** What the owner's WhatsApp gets when an action waits for them: the sentence and the two answers. */
export function approvalText(
  a: { ref: number; summary: { code: string; params: Record<string, string | number> } },
  locale: Locale,
): string {
  const what = summaryText(a.summary, locale);
  return locale === 'en'
    ? `🤖 Waiting for you (#${a.ref}): ${what}\nReply "yes ${a.ref}" to approve or "no ${a.ref}" to drop it.`
    : `🤖 מחכה לאישור שלך (#${a.ref}): ${what}\nלאישור השיבו "כן ${a.ref}", לביטול "לא ${a.ref}".`;
}

export type OwnerReply = { verb: 'confirm' | 'dismiss'; ref: number };

/** "כן 12", "אישור #12", "לא 12", "yes 12", "no 12": a decision on one waiting action. Anything else is not one. */
export function ownerReply(text: string): OwnerReply | null {
  const m = /^\s*(כן|אישור|אשר|מאשר|מאשרת|yes|ok|לא|no)\s*#?\s*(\d{1,6})\s*[.!]?\s*$/i.exec(text);
  if (!m) return null;
  const word = (m[1] as string).toLowerCase();
  return { verb: word === 'לא' || word === 'no' ? 'dismiss' : 'confirm', ref: Number(m[2]) };
}

export type DecisionOutcome =
  'confirmed' | 'failed' | 'dismissed' | 'not_found' | 'already_decided' | 'off';

/** The answer the owner's WhatsApp gets after a decision. */
export function decisionText(
  o: { outcome: DecisionOutcome; ref: number; summary: string | null },
  locale: Locale,
): string {
  const he: Record<DecisionOutcome, string> = {
    confirmed: `✅ בוצע (#${o.ref}): ${o.summary}`,
    failed: `⚠️ לא הצלחתי לבצע (#${o.ref}): ${o.summary}. הכללים לא אפשרו את זה, הפרטים ביומן של המוח.`,
    dismissed: `👍 ביטלתי (#${o.ref}): ${o.summary}`,
    not_found: `לא מצאתי פעולה מספר ${o.ref} שמחכה לך.`,
    already_decided: `פעולה ${o.ref} כבר הוחלטה.`,
    off: 'אישורים בוואטסאפ לא מופעלים.',
  };
  const en: Record<DecisionOutcome, string> = {
    confirmed: `✅ Done (#${o.ref}): ${o.summary}`,
    failed: `⚠️ Could not do it (#${o.ref}): ${o.summary}. The rules refused it; the brain's journal has the details.`,
    dismissed: `👍 Dropped (#${o.ref}): ${o.summary}`,
    not_found: `No action number ${o.ref} is waiting for you.`,
    already_decided: `Action ${o.ref} was already decided.`,
    off: 'WhatsApp approvals are off.',
  };
  return (locale === 'en' ? en : he)[o.outcome];
}

/**
 * An instructor's message saying they cannot teach on a day: "אני חולה היום", "לא אוכל להגיע מחר",
 * "לא אגיע ב-2026-11-05", "can't come tomorrow". With no day named it means today. Anything else is not one.
 */
export function staffAbsence(text: string, today: string): { date: string } | null {
  const t = text.trim().replace(/\s+/g, ' ');
  const cannot =
    /(חול(?:ה|ת)|לא (?:אוכל|יכול|יכולה|אגיע|מגיע|מגיעה|אהיה|אצליח)|נאלץ לבטל|נאלצת לבטל|sick|can'?t (?:come|make it|teach)|cannot (?:come|teach))/i;
  if (!cannot.test(t)) return null;
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(t);
  if (iso) return { date: iso[1] as string };
  const dm = /(?:^|\s|ב-?)(\d{1,2})[./](\d{1,2})(?![./]?\d)/.exec(t);
  if (dm) {
    const [y] = today.split('-');
    const date = `${y}-${(dm[2] as string).padStart(2, '0')}-${(dm[1] as string).padStart(2, '0')}`;
    // A day already past this year means next year's.
    return { date: date < today ? `${Number(y) + 1}${date.slice(4)}` : date };
  }
  if (/מחר|tomorrow/i.test(t)) {
    return {
      date: new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    };
  }
  return { date: today };
}

/** What the instructor's WhatsApp gets back. */
export function staffReplyText(
  r: { date: string; lessons: number; waiting: number },
  locale: Locale,
): string {
  const d = dmy(r.date);
  if (locale === 'en') {
    if (r.lessons === 0)
      return `Thanks. I found no lessons of yours on ${d}; I passed your message to the office.`;
    return r.waiting > 0
      ? `Thanks, feel better. ${r.lessons} lesson(s) on ${d}: looking for a substitute waits for the office's approval, and the families will be told.`
      : `Thanks, feel better. I am looking for a substitute for your ${r.lessons} lesson(s) on ${d}; the families will be told.`;
  }
  if (r.lessons === 0) return `תודה. לא מצאתי לך שיעורים ב-${d}, העברתי את ההודעה למשרד.`;
  return r.waiting > 0
    ? `תודה, רפואה שלמה. ${r.lessons} שיעורים ב-${d}: חיפוש מחליף מחכה לאישור המשרד, וההורים יעודכנו.`
    : `תודה, רפואה שלמה. מחפשים מחליף ל-${r.lessons} השיעורים שלך ב-${d}, וההורים יעודכנו.`;
}

// ─── The morning check and the evening summary (stage 4) ────────────────────

export interface MorningFacts {
  /** Families that owe money, with the age of their oldest charge in days. */
  debts: { householdId: string; balanceAgorot: number; oldestDays: number }[];
  /** Lessons in the coming week with nobody to teach them. */
  uncovered: { sessionId: string }[];
  /** From the insights' rules: how old a debt must be before the brain asks the family to pay. */
  debtAttentionDays: number;
  /** Families the brain already asked to pay within debtAttentionDays, or who hold an unpaid link. */
  askedHouseholds: readonly string[];
  /** Lessons the brain already looks for an instructor for (or the owner dropped). */
  coveredSessions: readonly string[];
  levels: { payment_link: AutonomyLevel; substitute: AutonomyLevel };
}

export interface MorningPlan {
  payments: { householdId: string; amountAgorot: number }[];
  substitutes: { sessionId: string }[];
}

/** The smallest payment link (agorot); a smaller balance is not worth a link. */
export const MIN_LINK_AGOROT = 100;

/**
 * What the morning check proposes: a payment link to each family whose debt reached the insights' attention age and
 * who was not asked lately, and an instructor search for each uncovered lesson not already being handled. A kind the
 * owner turned off proposes nothing. The gate then decides, per action, whether it runs or waits.
 */
export function morningPlan(f: MorningFacts): MorningPlan {
  const asked = new Set(f.askedHouseholds);
  const covered = new Set(f.coveredSessions);
  return {
    payments:
      f.levels.payment_link === 'off'
        ? []
        : f.debts
            .filter(
              (d) =>
                d.oldestDays >= f.debtAttentionDays &&
                d.balanceAgorot >= MIN_LINK_AGOROT &&
                !asked.has(d.householdId),
            )
            .sort((a, b) => b.balanceAgorot - a.balanceAgorot)
            .map((d) => ({ householdId: d.householdId, amountAgorot: d.balanceAgorot })),
    substitutes:
      f.levels.substitute === 'off'
        ? []
        : f.uncovered
            .filter((u) => !covered.has(u.sessionId))
            .map((u) => ({ sessionId: u.sessionId })),
  };
}

export interface DayFacts {
  date: string;
  /** Actions of the day that ran without a tap, that the owner approved, that wait now, and that the rules refused. */
  alone: number;
  approved: number;
  waiting: number;
  failed: number;
  tomorrowLessons: number;
  tomorrowUncovered: number;
}

/** The evening WhatsApp to the owner: what the brain did today and what tomorrow holds. */
export function eveningText(d: DayFacts, locale: Locale): string {
  const date = dmy(d.date);
  if (locale === 'en') {
    return [
      `🌙 The brain's day (${date})`,
      `• Done on its own: ${d.alone}`,
      `• Approved by you: ${d.approved}`,
      `• Waiting for you: ${d.waiting}${d.waiting ? ' (reply "yes <number>" to approve)' : ''}`,
      `• Refused by the rules: ${d.failed}`,
      `Tomorrow: ${d.tomorrowLessons} lessons${d.tomorrowUncovered ? `, ${d.tomorrowUncovered} without an instructor` : ''}.`,
    ].join('\n');
  }
  return [
    `🌙 היום של המוח (${date})`,
    `• בוצעו לבד: ${d.alone}`,
    `• אושרו על ידך: ${d.approved}`,
    `• מחכות לך: ${d.waiting}${d.waiting ? ' (לאישור השיבו "כן <מספר>")' : ''}`,
    `• הכללים לא אפשרו: ${d.failed}`,
    `מחר: ${d.tomorrowLessons} שיעורים${d.tomorrowUncovered ? `, ${d.tomorrowUncovered} בלי מדריך` : ''}.`,
  ].join('\n');
}
