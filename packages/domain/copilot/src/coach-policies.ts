/**
 * The weekly coach on WhatsApp (docs/AI-BRAIN.md stage 8, WhatsApp track W8). Pure: from the week's facts it picks at
 * most three things the owner should look at this week, in a fixed order of urgency, says what went well, checks how
 * last week's advice went, and writes the Sunday message. What she can do is one reply: "כן 12 13" approves every
 * action that carries out a priority, or a sentence to her assistant. Rules only: it costs no AI on any level.
 */
import { forecastLines, type Forecast } from './forecast-policies';

type Locale = 'he' | 'en';

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const ils = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('en-US')}`;

export interface CoachFacts {
  /** The Sunday the week starts. */
  weekOf: string;
  /** Last week. Money in agorot. */
  newPlaces: number;
  endedPlaces: number;
  collectedAgorot: number;
  /** Actions that wait for the owner, oldest first, with the sentence each one shows and their kind. */
  waiting: readonly { ref: number; summary: string; kind?: string }[];
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
  /** The forecast (stage 7): its lines show next month as ranges and its warnings. */
  forecast?: Forecast | null;
  /** Collected in the week before last, to say whether last week brought in more. */
  prevCollectedAgorot?: number | null;
  /** Last week's priorities as the coach sent them, to check how its advice went. */
  lastWeek?: readonly CoachPriority[] | null;
}

/**
 * One thing that matters this week. `refs` are the waiting actions that carry it out (the morning check's payment
 * links for old debts, its substitute searches for uncovered lessons, anything else that waits): one "כן" with all of
 * them does it. They are kept with the week, so next Sunday the coach knows which of them she decided.
 */
export type CoachPriority =
  | {
      kind: 'waiting';
      count: number;
      top: readonly { ref: number; summary: string }[];
      refs: readonly number[];
    }
  | { kind: 'uncovered'; count: number; refs: readonly number[] }
  | { kind: 'debts'; count: number; amountAgorot: number; refs: readonly number[] }
  | { kind: 'empty_group'; name: string; held: number; capacity: number };

export const COACH_MAX_PRIORITIES = 3;
/** At most this many actions in one reply ("כן 1 2 3 ..."), the same cap as the WhatsApp decision. */
export const COACH_MAX_REFS = 10;

const refsOf = (list: readonly { ref: number }[]) =>
  list.slice(0, COACH_MAX_REFS).map((a) => a.ref);

/** This week's priorities, most urgent first: what waits for her, lessons without an instructor, old debts, an emptying group. */
export function coachPriorities(f: CoachFacts): CoachPriority[] {
  const out: CoachPriority[] = [];
  // The morning check's links and searches belong to the priority they carry out, when that priority is there.
  const links = f.debts.count > 0 ? f.waiting.filter((a) => a.kind === 'payment_link') : [];
  const searches = f.uncovered > 0 ? f.waiting.filter((a) => a.kind === 'substitute') : [];
  const rest = f.waiting.filter((a) => !links.includes(a) && !searches.includes(a));
  if (rest.length > 0)
    out.push({
      kind: 'waiting',
      count: rest.length,
      top: rest.slice(0, 3).map((a) => ({ ref: a.ref, summary: a.summary })),
      refs: refsOf(rest),
    });
  if (f.uncovered > 0) out.push({ kind: 'uncovered', count: f.uncovered, refs: refsOf(searches) });
  if (f.debts.count > 0) out.push({ kind: 'debts', ...f.debts, refs: refsOf(links) });
  const emptiest = f.groups
    .filter((g) => g.capacity > 0 && (g.held / g.capacity) * 100 < f.lowOccupancyPct)
    .sort((a, b) => a.held / a.capacity - b.held / b.capacity)[0];
  if (emptiest) out.push({ kind: 'empty_group', ...emptiest });
  return out.slice(0, COACH_MAX_PRIORITIES);
}

/** done: handled; better: moved the right way; open: as it was (or worse); gone: nothing left to judge it by. */
export type CoachVerdict = 'done' | 'better' | 'open' | 'gone';

export type CoachReviewLine = {
  kind: CoachPriority['kind'];
  verdict: CoachVerdict;
  /** What the advice was about, as numbers then and now. */
  before: number;
  after: number;
  /** The group's name, for an emptying group. */
  name?: string;
};

/**
 * How last week's advice went, judged on this week's facts: the actions she was asked about decided or not, lessons
 * still without an instructor, old debts and what they add up to, and seats held in the group that ran near empty.
 */
export function coachReview(f: CoachFacts): CoachReviewLine[] {
  const waitingNow = new Set(f.waiting.map((a) => a.ref));
  return (f.lastWeek ?? []).map((p): CoachReviewLine => {
    switch (p.kind) {
      case 'waiting': {
        const refs = p.refs;
        const left = refs.filter((r) => waitingNow.has(r)).length;
        return {
          kind: p.kind,
          before: refs.length,
          after: left,
          verdict: left === 0 ? 'done' : left < refs.length ? 'better' : 'open',
        };
      }
      case 'uncovered':
        return {
          kind: p.kind,
          before: p.count,
          after: f.uncovered,
          verdict: f.uncovered === 0 ? 'done' : f.uncovered < p.count ? 'better' : 'open',
        };
      case 'debts':
        return {
          kind: p.kind,
          before: p.amountAgorot,
          after: f.debts.amountAgorot,
          verdict:
            f.debts.count === 0
              ? 'done'
              : f.debts.amountAgorot < p.amountAgorot
                ? 'better'
                : 'open',
        };
      case 'empty_group': {
        const g = f.groups.find((x) => x.name === p.name);
        if (!g || g.capacity === 0)
          return { kind: p.kind, name: p.name, before: p.held, after: 0, verdict: 'gone' };
        const filled = (g.held / g.capacity) * 100 >= f.lowOccupancyPct;
        return {
          kind: p.kind,
          name: p.name,
          before: p.held,
          after: g.held,
          verdict: filled ? 'done' : g.held > p.held ? 'better' : 'open',
        };
      }
    }
  });
}

/** What went well last week, at most three lines: advice that worked, more joining than leaving, more collected, a clear desk. */
export function coachWins(
  f: CoachFacts,
  review: readonly CoachReviewLine[],
  locale: Locale,
): string[] {
  const en = locale === 'en';
  const out: string[] = [];
  const worked = review.filter((r) => r.verdict === 'done' || r.verdict === 'better').length;
  if (worked > 0)
    out.push(
      en
        ? `${worked} of last week's ${review.length} priorities moved forward.`
        : `${worked} מתוך ${review.length} הדברים מהשבוע שעבר התקדמו.`,
    );
  if (f.newPlaces > f.endedPlaces)
    out.push(
      en
        ? `${f.newPlaces - f.endedPlaces} more places than a week ago.`
        : `${f.newPlaces - f.endedPlaces} מקומות יותר משבוע קודם.`,
    );
  if (f.prevCollectedAgorot != null && f.collectedAgorot > f.prevCollectedAgorot)
    out.push(
      en
        ? `${ils(f.collectedAgorot - f.prevCollectedAgorot)} more collected than the week before.`
        : `נגבו ${ils(f.collectedAgorot - f.prevCollectedAgorot)} יותר מהשבוע שלפניו.`,
    );
  if (f.waiting.length === 0 && f.uncovered === 0)
    out.push(
      en
        ? 'Nothing waits for you and every lesson has an instructor.'
        : 'שום דבר לא מחכה לך וכל השיעורים מאוישים.',
    );
  return out.slice(0, 3);
}

/** One line on how a priority of last week went, for the message and the coach's screen. */
export function reviewLine(r: CoachReviewLine, locale: Locale): string {
  const en = locale === 'en';
  const mark = { done: '✅', better: '↗️', open: '⏳', gone: '•' }[r.verdict];
  switch (r.kind) {
    case 'waiting':
      return en
        ? `${mark} Actions waiting for you: ${r.before - r.after} of ${r.before} decided.`
        : `${mark} פעולות שחיכו לך: ${r.before - r.after} מתוך ${r.before} הוחלטו.`;
    case 'uncovered':
      return en
        ? `${mark} Lessons without an instructor: ${r.before} then, ${r.after} now.`
        : `${mark} שיעורים בלי מדריך: ${r.before} אז, ${r.after} עכשיו.`;
    case 'debts':
      return en
        ? `${mark} Old debts: ${ils(r.before)} then, ${ils(r.after)} now.`
        : `${mark} חובות ישנים: ${ils(r.before)} אז, ${ils(r.after)} עכשיו.`;
    case 'empty_group':
      if (r.verdict === 'gone')
        return en
          ? `${mark} The group ${r.name} is no longer running.`
          : `${mark} הקבוצה ${r.name} כבר לא פעילה.`;
      return en
        ? `${mark} The group ${r.name}: ${r.before} children then, ${r.after} now.`
        : `${mark} הקבוצה ${r.name}: ${r.before} ילדים אז, ${r.after} עכשיו.`;
  }
}

/** "כן 12 13 14": the one reply that approves every action of a priority. */
const yesAll = (refs: readonly number[], locale: Locale) =>
  locale === 'en' ? `"yes ${refs.join(' ')}"` : `"כן ${refs.join(' ')}"`;

function priorityLines(p: CoachPriority, n: number, assistant: boolean, locale: Locale): string[] {
  const en = locale === 'en';
  switch (p.kind) {
    case 'waiting': {
      const refs = p.refs;
      return [
        en
          ? `${n}. ${p.count} action(s) wait for your decision:`
          : `${n}. ${p.count} פעולות מחכות להחלטה שלך:`,
        ...p.top.map((a) =>
          en
            ? `   • ${a.summary}: reply "yes ${a.ref}" or "no ${a.ref}"`
            : `   • ${a.summary}: השיבו "כן ${a.ref}" או "לא ${a.ref}"`,
        ),
        ...(refs.length > 1
          ? [
              en
                ? `   👉 All at once: reply ${yesAll(refs, locale)}`
                : `   👉 הכל בבת אחת: השיבו ${yesAll(refs, locale)}`,
            ]
          : []),
      ];
    }
    case 'uncovered': {
      const refs = p.refs;
      return [
        refs.length > 0
          ? en
            ? `${n}. ${p.count} lesson(s) this week have no instructor. Substitute searches are ready: reply ${yesAll(refs, locale)} to start them.`
            : `${n}. ${p.count} שיעורים השבוע בלי מדריך. חיפושי מחליף מוכנים: השיבו ${yesAll(refs, locale)} כדי להתחיל.`
          : en
            ? `${n}. ${p.count} lesson(s) this week have no instructor. The morning check opens a substitute search for each, by your level.`
            : `${n}. ${p.count} שיעורים השבוע בלי מדריך. בדיקת הבוקר פותחת לכל אחד חיפוש מחליף, לפי הרמה שקבעת.`,
      ];
    }
    case 'debts': {
      const refs = p.refs;
      return [
        (en
          ? `${n}. ${p.count} families owe ${ils(p.amountAgorot)} for a long time.`
          : `${n}. ${p.count} משפחות חייבות ${ils(p.amountAgorot)} כבר זמן רב.`) +
          (refs.length > 0
            ? en
              ? ` Payment links are ready: reply ${yesAll(refs, locale)} to send them.`
              : ` קישורי תשלום מוכנים: השיבו ${yesAll(refs, locale)} לשליחה.`
            : assistant
              ? en
                ? ' Reply "who owes us?" for the list.'
                : ' השיבו "מי חייב לנו?" לרשימה.'
              : en
                ? ' The list is on the money screen.'
                : ' הרשימה במסך הכספים.'),
      ];
    }
    case 'empty_group':
      return [
        en
          ? `${n}. The group ${p.name} runs near empty (${p.held} of ${p.capacity}). Worth filling from the waiting list or merging.`
          : `${n}. הקבוצה ${p.name} כמעט ריקה (${p.held} מתוך ${p.capacity}). כדאי למלא מרשימת ההמתנה או לאחד.`,
      ];
  }
}

/**
 * The Sunday message, or null when there is nothing worth a message (no priority, nothing ahead and no advice of
 * last week to check). What went well alone is not a reason to write.
 */
export function coachText(f: CoachFacts, locale: Locale): string | null {
  const en = locale === 'en';
  const priorities = coachPriorities(f);
  const review = coachReview(f);
  const next = f.ahead[0] ?? null;
  const ahead = f.forecast ? forecastLines(f.forecast, locale) : [];
  if (priorities.length === 0 && !next && ahead.length === 0 && review.length === 0) return null;
  const lines: string[] = [
    en ? `🧭 Your week (from ${dm(f.weekOf)})` : `🧭 השבוע שלך (מ-${dm(f.weekOf)})`,
    en
      ? `Last week: ${f.newPlaces} joined, ${f.endedPlaces} left, ${ils(f.collectedAgorot)} collected.`
      : `בשבוע שעבר: ${f.newPlaces} הצטרפו, ${f.endedPlaces} עזבו, נגבו ${ils(f.collectedAgorot)}.`,
  ];
  const wins = coachWins(f, review, locale);
  if (wins.length > 0)
    lines.push('', en ? '✨ What went well:' : '✨ מה הלך טוב:', ...wins.map((w) => `• ${w}`));
  if (review.length > 0)
    lines.push(
      '',
      en ? "Last week's advice:" : 'מה שהצעתי בשבוע שעבר:',
      ...review.map((r) => reviewLine(r, locale)),
    );
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
  if (ahead.length) lines.push('', ...ahead);
  return lines.join('\n');
}
