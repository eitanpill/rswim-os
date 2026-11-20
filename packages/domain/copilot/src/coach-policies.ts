/**
 * The weekly coach on WhatsApp (docs/AI-BRAIN.md stages 7 and 8, WhatsApp track W8). Pure: from the week's facts it
 * picks at most three things the owner should look at this week, in a fixed order of urgency, and writes the Sunday
 * message. What she can do is a reply: "כן N" for an action that waits, or a sentence to her assistant.
 */
type Locale = 'he' | 'en';

export interface CoachFacts {
  /** The Sunday the week starts. */
  weekOf: string;
  /** Last week. Money in agorot. */
  newPlaces: number;
  endedPlaces: number;
  collectedAgorot: number;
  /** Actions that wait for the owner, oldest first, with the sentence each one shows. */
  waiting: readonly { ref: number; summary: string }[];
  /** Lessons in the coming week with nobody to teach them. */
  uncovered: number;
  /** Families whose debt passed the attention age, and what they owe together. */
  debts: { count: number; amountAgorot: number };
  /** Regular groups, with seats held and capacity. */
  groups: readonly { name: string; held: number; capacity: number }[];
  /** A group under this share of its capacity is running near empty. */
  lowOccupancyPct: number;
  /** Holidays in the coming weeks, nearest first. */
  ahead: readonly { name: string; date: string; daysAway: number }[];
  /** Whether her assistant answers on WhatsApp (plan, policy and a model): only then the message suggests asking it. */
  assistant: boolean;
  /** The same month a year ago, when the brain remembers it. */
  lastYear: { period: string; newPlaces: number; endedPlaces: number } | null;
}

export type CoachPriority =
  | { kind: 'waiting'; count: number; top: readonly { ref: number; summary: string }[] }
  | { kind: 'uncovered'; count: number }
  | { kind: 'debts'; count: number; amountAgorot: number }
  | { kind: 'empty_group'; name: string; held: number; capacity: number };

export const COACH_MAX_PRIORITIES = 3;

/** This week's priorities, most urgent first: what waits for her, lessons without an instructor, old debts, an emptying group. */
export function coachPriorities(f: CoachFacts): CoachPriority[] {
  const out: CoachPriority[] = [];
  if (f.waiting.length > 0)
    out.push({ kind: 'waiting', count: f.waiting.length, top: f.waiting.slice(0, 3) });
  if (f.uncovered > 0) out.push({ kind: 'uncovered', count: f.uncovered });
  if (f.debts.count > 0) out.push({ kind: 'debts', ...f.debts });
  const emptiest = f.groups
    .filter((g) => g.capacity > 0 && (g.held / g.capacity) * 100 < f.lowOccupancyPct)
    .sort((a, b) => a.held / a.capacity - b.held / b.capacity)[0];
  if (emptiest) out.push({ kind: 'empty_group', ...emptiest });
  return out.slice(0, COACH_MAX_PRIORITIES);
}

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const ils = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('en-US')}`;

function priorityLines(p: CoachPriority, n: number, assistant: boolean, locale: Locale): string[] {
  const en = locale === 'en';
  switch (p.kind) {
    case 'waiting':
      return [
        en
          ? `${n}. ${p.count} action(s) wait for your decision:`
          : `${n}. ${p.count} פעולות מחכות להחלטה שלך:`,
        ...p.top.map((a) =>
          en
            ? `   • ${a.summary}: reply "yes ${a.ref}" or "no ${a.ref}"`
            : `   • ${a.summary}: השיבו "כן ${a.ref}" או "לא ${a.ref}"`,
        ),
      ];
    case 'uncovered':
      return [
        en
          ? `${n}. ${p.count} lesson(s) this week have no instructor. The morning check opens a substitute search for each, by your level.`
          : `${n}. ${p.count} שיעורים השבוע בלי מדריך. בדיקת הבוקר פותחת לכל אחד חיפוש מחליף, לפי הרמה שקבעת.`,
      ];
    case 'debts':
      return [
        (en
          ? `${n}. ${p.count} families owe ${ils(p.amountAgorot)} for a long time.`
          : `${n}. ${p.count} משפחות חייבות ${ils(p.amountAgorot)} כבר זמן רב.`) +
          (assistant
            ? en
              ? ' Reply "who owes us?" for the list.'
              : ' השיבו "מי חייב לנו?" לרשימה.'
            : en
              ? ' The list is on the money screen.'
              : ' הרשימה במסך הכספים.'),
      ];
    case 'empty_group':
      return [
        en
          ? `${n}. The group ${p.name} runs near empty (${p.held} of ${p.capacity}). Worth filling from the waiting list or merging.`
          : `${n}. הקבוצה ${p.name} כמעט ריקה (${p.held} מתוך ${p.capacity}). כדאי למלא מרשימת ההמתנה או לאחד.`,
      ];
  }
}

/** The Sunday message, or null when there is nothing worth a message (no priority and nothing ahead). */
export function coachText(f: CoachFacts, locale: Locale): string | null {
  const en = locale === 'en';
  const priorities = coachPriorities(f);
  const next = f.ahead[0] ?? null;
  if (priorities.length === 0 && !next) return null;
  const lines: string[] = [
    en ? `🧭 Your week (from ${dm(f.weekOf)})` : `🧭 השבוע שלך (מ-${dm(f.weekOf)})`,
    en
      ? `Last week: ${f.newPlaces} joined, ${f.endedPlaces} left, ${ils(f.collectedAgorot)} collected.`
      : `בשבוע שעבר: ${f.newPlaces} הצטרפו, ${f.endedPlaces} עזבו, נגבו ${ils(f.collectedAgorot)}.`,
  ];
  if (priorities.length > 0) {
    lines.push('', en ? 'What matters this week:' : 'מה חשוב השבוע:');
    priorities.forEach((p, i) => lines.push(...priorityLines(p, i + 1, f.assistant, locale)));
  }
  if (next) {
    lines.push(
      '',
      en
        ? `Ahead: ${next.name} in ${next.daysAway} days (${dm(next.date)}).`
        : `מבט קדימה: ${next.name} בעוד ${next.daysAway} ימים (${dm(next.date)}).`,
    );
    if (f.lastYear)
      lines.push(
        en
          ? `The same month last year: ${f.lastYear.newPlaces} joined, ${f.lastYear.endedPlaces} left.`
          : `באותו חודש בשנה שעברה: ${f.lastYear.newPlaces} הצטרפו, ${f.lastYear.endedPlaces} עזבו.`,
      );
  }
  return lines.join('\n');
}
