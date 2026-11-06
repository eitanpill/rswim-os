/**
 * Pure rules of the brain's memory (docs/AI-BRAIN.md, stage 5): reading "תזכור ש..." from the owner, naming months the
 * way the owner does, and the sentences events and comparisons read as on WhatsApp and to the model.
 */
import type { MemoryEventKind } from '@rswim/contracts';
import {
  MONTH_MEASURES,
  type MeasureChange,
  type MonthMeasure,
} from '@rswim/domain-reports/policies';
import type { Explanation } from './policies';

type Locale = 'he' | 'en';

// ─── The owner asks to remember ─────────────────────────────────────────────

/**
 * "תזכור ש...", "זכור: ...", "תרשום לך ש...", "remember that ...": the note in the owner's words, or null for anything
 * else. Too short to mean something is null too.
 */
export function rememberRequest(text: string): { body: string } | null {
  const t = text.trim().replace(/\s+/g, ' ');
  const m =
    /^(?:תזכור|תזכרי|זכור|זכרי|לזכור|תרשום לך|תרשמי לך|רשום לך)(?: (?:ש|כי |את זה:?)|:| -|,)? ?(.+)$/.exec(
      t,
    ) ?? /^remember(?: that|:)? (.+)$/i.exec(t);
  const body = m ? (m[1] as string).trim().replace(/^ש(?=\S)/, '') : '';
  return body.length >= 2 ? { body: body.slice(0, 1000) } : null;
}

const REMEMBERED: Record<Locale, string> = {
  he: '📝 שמרתי: "{body}". אפשר לראות ולמחוק בעמוד הזיכרון של המוח.',
  en: '📝 Saved: "{body}". You can see and delete it on the brain\'s memory page.',
};

const fill = (s: string, p: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ''));

/** The one line back to the owner after a note from WhatsApp. */
export function rememberedText(body: string, locale: Locale): string {
  return fill(REMEMBERED[locale], { body: body.length > 120 ? `${body.slice(0, 117)}...` : body });
}

// ─── Months ─────────────────────────────────────────────────────────────────

/** "YYYY-MM" of a date. */
export const periodOf = (date: string) => date.slice(0, 7);

/** The month `n` months after (or before, with a negative n) a period. */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const HE_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

/**
 * A month as the owner names it: "2026-04", "החודש", "החודש שעבר" / "חודש שעבר", or a month's name ("אפריל",
 * "באפריל"), which is the latest such month up to now. Null when it is not a month.
 */
export function periodFromWords(words: string, today: string): string | null {
  const w = words.trim().replace(/^ב-?/, '');
  const iso = /^(\d{4}-\d{2})$/.exec(w);
  if (iso) return iso[1] as string;
  const now = periodOf(today);
  if (/^(?:ה)?חודש(?: הזה)?$/.test(w)) return now;
  if (/^(?:ה)?חודש (?:ה)?קודם$|^(?:ה)?חודש שעבר$/.test(w)) return shiftPeriod(now, -1);
  const named = HE_MONTHS.findIndex((m) => w === m);
  if (named < 0) return null;
  const month = named + 1;
  const [y, m] = now.split('-').map(Number) as [number, number];
  const year = month <= m ? y : y - 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "אפריל 2026" / "April 2026". */
export function periodName(period: string, locale: Locale): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  if (locale === 'he') return `${HE_MONTHS[m - 1]} ${y}`;
  return (
    new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }) +
    ` ${y}`
  );
}

/** Whether a month needs computing again: the running month, and a month that ended but was not computed since. */
export function snapshotDue(
  period: string,
  today: string,
  stored: { final: boolean } | undefined,
): { due: boolean; final: boolean } {
  const ended = period < periodOf(today);
  if (!ended) return { due: true, final: false };
  return { due: !stored?.final, final: true };
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** The same sentences the memory screen shows (agent.memory.events.*), for WhatsApp and the model. */
const EVENT_TEXT: Record<Locale, Record<MemoryEventKind, string>> = {
  he: {
    closure: 'השיעורים בוטלו {from}–{until} ב{venue}: {reason} ({sessions} שיעורים)',
    substitute: 'חיפוש מחליף/ה ל{staff} בקבוצת {group} ב-{date}: {outcome}',
    price_list: 'מחירון חדש "{name}" מ-{from}',
    group_opened: 'נפתחה קבוצה חדשה: {group} ב{venue}, מ-{from}',
    group_closed: 'הקבוצה {group} ב{venue} נסגרה ב-{until}',
  },
  en: {
    closure: 'Lessons cancelled {from}–{until} at {venue}: {reason} ({sessions} lessons)',
    substitute: 'Substitute search for {staff} in {group} on {date}: {outcome}',
    price_list: 'New price list "{name}" from {from}',
    group_opened: 'New group opened: {group} at {venue}, from {from}',
    group_closed: 'Group {group} at {venue} closed on {until}',
  },
};

const OUTCOME_TEXT: Record<Locale, Record<string, string>> = {
  he: {
    filled: 'נמצא/ה מחליף/ה',
    unfilled: 'לא נמצא/ה מחליף/ה',
    open: 'עדיין מחפשים',
    cancelled: 'בוטל',
  },
  en: {
    filled: 'filled',
    unfilled: 'nobody found',
    open: 'still searching',
    cancelled: 'withdrawn',
  },
};

const ALL_VENUES: Record<Locale, string> = { he: 'כל הבריכות', en: 'all venues' };

/** An event's summary (agent.memory.events.<kind>) as one sentence. */
export function eventText(summary: Explanation, locale: Locale): string {
  const kind = summary.code.split('.').pop() as MemoryEventKind;
  const template = EVENT_TEXT[locale][kind] ?? summary.code;
  const p = { ...summary.params };
  if (kind === 'closure' && !p.venue) p.venue = ALL_VENUES[locale];
  if (kind === 'substitute')
    p.outcome = OUTCOME_TEXT[locale][String(p.outcome)] ?? String(p.outcome);
  return fill(template, p);
}

export interface MemoryLine {
  kind: 'note' | 'event';
  happenedOn: string;
  subjectLabel: string | null;
  body: string | null;
  summary: Explanation | null;
}

/** A memory as the model reads it: its day, its subject and what it says. */
export function memoryLine(m: MemoryLine, locale: Locale): string {
  const what = m.kind === 'note' ? (m.body as string) : eventText(m.summary as Explanation, locale);
  return `${m.happenedOn}${m.subjectLabel ? ` · ${m.subjectLabel}` : ''} · ${what}`;
}

// ─── Comparisons ────────────────────────────────────────────────────────────

const MEASURE_TEXT: Record<Locale, Record<MonthMeasure, string>> = {
  he: {
    placesAtEnd: 'מקומות בסוף החודש',
    newPlaces: 'הצטרפו',
    endedPlaces: 'עזבו',
    lessonsHeld: 'שיעורים',
    lessonsCancelled: 'שיעורים שבוטלו',
    absencePct: 'היעדרויות (%)',
    trialsHeld: 'שיעורי ניסיון',
    trialsEnrolled: 'נרשמו אחרי ניסיון',
    chargedAgorot: 'חויב (₪)',
    collectedAgorot: 'נגבה (₪)',
  },
  en: {
    placesAtEnd: 'Places at month end',
    newPlaces: 'Joined',
    endedPlaces: 'Left',
    lessonsHeld: 'Lessons',
    lessonsCancelled: 'Lessons cancelled',
    absencePct: 'Absences (%)',
    trialsHeld: 'Trial lessons',
    trialsEnrolled: 'Enrolled after a trial',
    chargedAgorot: 'Charged (₪)',
    collectedAgorot: 'Collected (₪)',
  },
};

const money = (m: MonthMeasure) => m === 'chargedAgorot' || m === 'collectedAgorot';
const shown = (m: MonthMeasure, v: number | null) =>
  v === null ? '—' : money(m) ? Math.round(v / 100).toLocaleString('en') : String(v);

/** A comparison as short lines ("מקומות בסוף החודש: 112 (לפני: 100, +12%)"), for WhatsApp and the model. */
export function changeLines(changes: readonly MeasureChange[], locale: Locale): string[] {
  const before = locale === 'he' ? 'לפני' : 'before';
  return MONTH_MEASURES.map((m) => {
    const c = changes.find((x) => x.measure === m) as MeasureChange;
    const tail =
      c.before === null
        ? ''
        : ` (${before}: ${shown(m, c.before)}${c.pct !== null ? `, ${c.pct > 0 ? '+' : ''}${c.pct}%` : ''})`;
    return `${MEASURE_TEXT[locale][m]}: ${shown(m, c.now)}${tail}`;
  });
}
