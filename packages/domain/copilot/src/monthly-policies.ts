/**
 * The monthly report (docs/AI-BRAIN.md, stage 8): on the 1st, the owner gets the month that ended in one message. Its
 * numbers against the month before and the same month last year, how the coach's advice went over its weeks, what the
 * brain did on its own and what she decided, and the forecast's next month. Pure: the facts come from monthly.ts.
 */
import { absencePct, type MonthFacts } from '@rswim/domain-reports/policies';
import type { CoachReviewLine } from './coach-policies';
import { forecastLines, type Forecast } from './forecast-policies';

type Locale = 'he' | 'en';

export interface MonthlyFacts {
  /** The month that ended ("YYYY-MM"). */
  period: string;
  facts: MonthFacts;
  previous: MonthFacts | null;
  lastYear: MonthFacts | null;
  /** The coach's checks made during the month (each Sunday judged the week before). */
  reviews: readonly CoachReviewLine[];
  /** The brain's actions decided in the month. */
  actions: { alone: number; approved: number; dismissed: number; undone: number };
  forecast: Forecast | null;
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
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const monthName = (period: string, locale: Locale) =>
  `${(locale === 'en' ? EN_MONTHS : HE_MONTHS)[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const ils = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('en-US')}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Whether the month had anything to report: places, lessons or money. */
export function monthHadActivity(f: MonthFacts): boolean {
  return f.placesAtEnd > 0 || f.lessonsHeld > 0 || f.chargedAgorot > 0 || f.collectedAgorot > 0;
}

/** How the coach's advice went over the month: how many checks, how many moved forward, how many were done. */
export function adviceTally(reviews: readonly CoachReviewLine[]): {
  total: number;
  moved: number;
  done: number;
} {
  const judged = reviews.filter((r) => r.verdict !== 'gone');
  return {
    total: judged.length,
    moved: judged.filter((r) => r.verdict === 'done' || r.verdict === 'better').length,
    done: judged.filter((r) => r.verdict === 'done').length,
  };
}

/** The month's message, or null for a month with nothing in it. */
export function monthlyText(m: MonthlyFacts, locale: Locale): string | null {
  const f = m.facts;
  if (!monthHadActivity(f)) return null;
  const en = locale === 'en';
  const lines: string[] = [
    en ? `📊 ${monthName(m.period, 'en')} in review` : `📊 סיכום ${monthName(m.period, 'he')}`,
  ];

  const against: string[] = [];
  if (m.previous)
    against.push(
      en
        ? `${signed(f.placesAtEnd - m.previous.placesAtEnd)} on the month before`
        : `${signed(f.placesAtEnd - m.previous.placesAtEnd)} מהחודש הקודם`,
    );
  if (m.lastYear)
    against.push(
      en
        ? `${signed(f.placesAtEnd - m.lastYear.placesAtEnd)} on the same month last year`
        : `${signed(f.placesAtEnd - m.lastYear.placesAtEnd)} מאותו חודש בשנה שעברה`,
    );
  lines.push(
    (en ? `Places: ${f.placesAtEnd} at month end` : `מקומות: ${f.placesAtEnd} בסוף החודש`) +
      (against.length ? ` (${against.join(', ')})` : '') +
      '.',
  );
  const absent = absencePct(f);
  lines.push(
    (en
      ? `${f.newPlaces} joined, ${f.endedPlaces} left, ${f.trialsHeld} trials (${f.trialsEnrolled} enrolled)`
      : `הצטרפו ${f.newPlaces}, עזבו ${f.endedPlaces}, ${f.trialsHeld} שיעורי ניסיון (${f.trialsEnrolled} נרשמו)`) +
      (absent === null ? '' : en ? `, ${absent}% absences` : `, ${absent}% היעדרויות`) +
      '.',
  );
  if (f.chargedAgorot > 0 || f.collectedAgorot > 0) {
    const share =
      f.chargedAgorot > 0 ? Math.round((f.collectedAgorot / f.chargedAgorot) * 100) : null;
    lines.push(
      (en
        ? `Charged ${ils(f.chargedAgorot)}, collected ${ils(f.collectedAgorot)}`
        : `חויבו ${ils(f.chargedAgorot)}, נגבו ${ils(f.collectedAgorot)}`) +
        (share === null ? '' : ` (${share}%)`) +
        '.',
    );
  }
  if (f.lessonsCancelled > 0)
    lines.push(
      en
        ? `${f.lessonsHeld} lessons held, ${f.lessonsCancelled} cancelled.`
        : `${f.lessonsHeld} שיעורים התקיימו, ${f.lessonsCancelled} בוטלו.`,
    );

  const advice = adviceTally(m.reviews);
  if (advice.total > 0)
    lines.push(
      en
        ? `The coach's advice: ${advice.moved} of ${advice.total} moved forward (${advice.done} done).`
        : `העצות של המאמן: ${advice.moved} מתוך ${advice.total} התקדמו (${advice.done} טופלו עד הסוף).`,
    );
  const a = m.actions;
  if (a.alone + a.approved + a.dismissed + a.undone > 0)
    lines.push(
      en
        ? `The brain: ${a.alone} done on its own, ${a.approved} you approved, ${a.dismissed} you dropped, ${a.undone} you took back.`
        : `המוח: ${a.alone} פעולות לבד, ${a.approved} אישרת, ${a.dismissed} דחית, ${a.undone} ביטלת.`,
    );

  const ahead = m.forecast ? forecastLines(m.forecast, locale) : [];
  if (ahead.length) lines.push('', ...ahead);
  return lines.join('\n');
}
