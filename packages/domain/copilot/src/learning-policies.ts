/**
 * Pure rules of how the brain learns the owner (docs/AI-BRAIN.md, stage 6). It reads her own decisions of the last
 * months: what she approves every time, what she takes back after it ran alone, and why she drops what it proposes.
 * From them it suggests a level per kind of action (never sets one: she accepts or declines), stops asking families she
 * called a special case, and stops proposing payment links she called too small. Nothing here goes above a kind's
 * ceiling.
 */
import {
  AGENT_ACTION_KINDS,
  AGENT_KIND_CEILING,
  type AgentActionKind,
  type AutonomyLevel,
  type DismissReason,
} from '@rswim/contracts';
import { capLevel, MIN_LINK_AGOROT } from './agent-policies';

type Locale = 'he' | 'en';

/** How far back the brain reads the owner's decisions. */
export const LEARN_WINDOW_DAYS = 90;
/** Owner decisions on a kind before the brain suggests running it alone, and the share of them she approved. */
export const LEARN_MIN_DECISIONS = 8;
export const LEARN_APPROVE_SHARE = 0.9;
/** Actions that ran alone before the brain suggests asking her again, how many she took back, and their share. */
export const LEARN_MIN_ALONE = 5;
export const LEARN_MIN_UNDONE = 2;
export const LEARN_UNDO_SHARE = 0.2;
/** A suggestion the owner declined is not made again for this long. */
export const LEARN_DECLINE_DAYS = 30;
/** A family the owner called a special case is not asked to pay by the morning check for this long. */
export const SPECIAL_CASE_DAYS = 90;

/** One decided action of the window, as the learning reads it. */
export interface DecisionRow {
  kind: AgentActionKind;
  status: 'confirmed' | 'failed' | 'dismissed' | 'undone';
  ranAlone: boolean;
  dismissReason: DismissReason | null;
}

export interface KindStats {
  /** Proposals she approved. */
  approved: number;
  /** Proposals she dropped as wrong or too small (or without a reason), and approvals she took back. */
  against: number;
  /** Proposals she dropped for now or as a special case: not a word about the kind itself. */
  neutral: number;
  /** Actions that ran without her tap, and how many of them she took back. */
  alone: number;
  undone: number;
}

const empty = (): KindStats => ({ approved: 0, against: 0, neutral: 0, alone: 0, undone: 0 });

/** Her decisions, counted per kind. */
export function kindStats(rows: readonly DecisionRow[]): Record<AgentActionKind, KindStats> {
  const out = Object.fromEntries(AGENT_ACTION_KINDS.map((k) => [k, empty()])) as Record<
    AgentActionKind,
    KindStats
  >;
  for (const r of rows) {
    const s = out[r.kind];
    if (r.ranAlone) {
      s.alone += 1;
      if (r.status === 'undone') s.undone += 1;
    } else if (r.status === 'dismissed') {
      if (r.dismissReason === 'not_now' || r.dismissReason === 'special_case') s.neutral += 1;
      else s.against += 1;
    } else if (r.status === 'undone') s.against += 1;
    else s.approved += 1;
  }
  return out;
}

export interface LevelSuggestion {
  kind: AgentActionKind;
  from: AutonomyLevel;
  to: AutonomyLevel;
  /** approves: she approves nearly all of them; undoes: she takes back too many of those that ran alone. */
  why: 'approves' | 'undoes';
  /** The evidence: `count` of `of` (approved of decided, or undone of ran alone). */
  count: number;
  of: number;
}

/**
 * What the brain suggests changing: a kind that waits for her and that she approves nearly every time runs alone (as
 * far as its ceiling allows); a kind that runs alone and that she takes back too often waits for her again. A kind she
 * turned off is left alone, and so is one whose suggestion she declined until that day passes.
 */
export function learnedSuggestions(f: {
  stats: Record<AgentActionKind, KindStats>;
  levels: Record<AgentActionKind, AutonomyLevel>;
  /** kind → the last day a declined suggestion stays quiet. */
  declined: Partial<Record<AgentActionKind, string>>;
  today: string;
}): LevelSuggestion[] {
  const out: LevelSuggestion[] = [];
  for (const kind of AGENT_ACTION_KINDS) {
    const quiet = f.declined[kind];
    if (quiet && quiet >= f.today) continue;
    const s = f.stats[kind];
    const level = f.levels[kind];
    if (level === 'suggest' || level === 'approve') {
      const to = capLevel('auto', AGENT_KIND_CEILING[kind]);
      const decided = s.approved + s.against;
      if (
        to === 'auto' &&
        decided >= LEARN_MIN_DECISIONS &&
        s.approved / decided >= LEARN_APPROVE_SHARE
      )
        out.push({ kind, from: level, to, why: 'approves', count: s.approved, of: decided });
    } else if (
      level === 'auto' &&
      s.alone >= LEARN_MIN_ALONE &&
      s.undone >= LEARN_MIN_UNDONE &&
      s.undone / s.alone >= LEARN_UNDO_SHARE
    ) {
      out.push({ kind, from: level, to: 'approve', why: 'undoes', count: s.undone, of: s.alone });
    }
  }
  return out;
}

/** The day a declined suggestion may come back after. */
export function declinedUntil(today: string): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) + LEARN_DECLINE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A payment link the owner dropped, as the morning check reads it. */
export interface LinkDismissal {
  householdId: string;
  reason: DismissReason | null;
  daysAgo: number;
}

/**
 * Families the morning check leaves out today: a special case for SPECIAL_CASE_DAYS, any other dropped link for the
 * insights' debt attention age (the same wait as after a link she sent).
 */
export function skippedHouseholds(
  dismissals: readonly LinkDismissal[],
  debtAttentionDays: number,
): string[] {
  return [
    ...new Set(
      dismissals
        .filter(
          (d) => d.daysAgo < (d.reason === 'special_case' ? SPECIAL_CASE_DAYS : debtAttentionDays),
        )
        .map((d) => d.householdId),
    ),
  ];
}

/**
 * The smallest balance worth a payment link: above the largest link she called too small, but never above the smallest
 * link she approved herself, and never below MIN_LINK_AGOROT.
 */
export function learnedMinLink(f: {
  tooSmall: readonly number[];
  approved: readonly number[];
}): number {
  if (!f.tooSmall.length) return MIN_LINK_AGOROT;
  const above = Math.max(...f.tooSmall) + 1;
  const cap = f.approved.length ? Math.min(...f.approved) : above;
  return Math.max(MIN_LINK_AGOROT, Math.min(above, cap));
}

// ─── What the owner reads ───────────────────────────────────────────────────

/** Kinds as the owner names them, for WhatsApp, where the web's messages are not. */
const KIND_TEXT: Record<Locale, Record<AgentActionKind, string>> = {
  he: {
    report_absence: 'רישום היעדרויות',
    book_makeup: 'קביעת השלמות',
    lesson_reminder: 'תזכורות לשיעורים',
    payment_link: 'קישורי תשלום',
    freeze: 'הקפאות',
    move_student: 'העברות בין קבוצות',
    message_family: 'הודעות למשפחות',
    substitute: 'חיפוש מחליפים',
    cancel_lessons: 'ביטול שיעורים',
    open_makeup_slots: 'פתיחת מקומות להשלמה',
  },
  en: {
    report_absence: 'recording absences',
    book_makeup: 'booking makeups',
    lesson_reminder: 'lesson reminders',
    payment_link: 'payment links',
    freeze: 'freezes',
    move_student: 'moving children between groups',
    message_family: 'messages to families',
    substitute: 'substitute searches',
    cancel_lessons: 'cancelling lessons',
    open_makeup_slots: 'opening makeup slots',
  },
};

export function kindText(kind: AgentActionKind, locale: Locale): string {
  return KIND_TEXT[locale][kind];
}

/** One suggestion as a sentence. */
export function suggestionText(s: LevelSuggestion, locale: Locale): string {
  const what = KIND_TEXT[locale][s.kind];
  if (locale === 'en') {
    return s.why === 'approves'
      ? `You approved ${s.count} of ${s.of} for ${what}. Shall I do them on my own and report?`
      : `You took back ${s.count} of the ${s.of} ${what} I did on my own. Shall I ask you first again?`;
  }
  return s.why === 'approves'
    ? `אישרת ${s.count} מתוך ${s.of} ב${what}. שאבצע אותם לבד ואדווח לך?`
    : `ביטלת ${s.count} מתוך ${s.of} ${what} שעשיתי לבד. שאחזור לשאול אותך קודם?`;
}

/**
 * The weekly WhatsApp to the owner: what the brain learned and what it suggests, answered on the brain's page. Null
 * when there is nothing to say.
 */
export function learningText(
  f: { suggestions: readonly LevelSuggestion[]; minLinkAgorot: number },
  locale: Locale,
): string | null {
  const lines = f.suggestions.map((s) => `• ${suggestionText(s, locale)}`);
  if (f.minLinkAgorot > MIN_LINK_AGOROT) {
    const amount = `₪${Math.ceil(f.minLinkAgorot / 100).toLocaleString('en-US')}`;
    lines.push(
      locale === 'en'
        ? `• Payment links below ${amount} I no longer propose (you called them too small).`
        : `• קישורי תשלום מתחת ל-${amount} אני כבר לא מציע (אמרת שהם קטנים מדי).`,
    );
  }
  if (!lines.length) return null;
  return locale === 'en'
    ? ['🧠 What I learned about how you work:', ...lines, "Answer on the brain's page."].join('\n')
    : ['🧠 מה למדתי על דרך העבודה שלך:', ...lines, 'אפשר לאשר או לדחות בעמוד המוח.'].join('\n');
}
