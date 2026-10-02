import { flags, HDate, HebrewCalendar, Location, Zmanim, type Event } from '@hebcal/core';

/** A local Israeli calendar date, `YYYY-MM-DD`. Lesson days and billing periods use this, never instants. */
export type LocalDate = string;

export interface DayInfo {
  date: LocalDate;
  weekday: number; // 0 = Sunday … 6 = Shabbat
  isShabbat: boolean;
  isErevShabbat: boolean;
  /** Full holiday with work restrictions (Rosh Hashana, Yom Kippur, Sukkot I, Shmini Atzeret, Pesach I/VII, Shavuot). */
  isYomTov: boolean;
  isYomKippur: boolean;
  /** The day before a Yom Tov. */
  isErevChag: boolean;
  isCholHaMoed: boolean;
  /** Yom Kippur and Tisha B'Av. */
  isMajorFast: boolean;
  isTishaBav: boolean;
  isYomHaZikaron: boolean;
  /** The day whose evening starts Yom HaZikaron. */
  isYomHaZikaronEve: boolean;
  isYomHaAtzmaut: boolean;
  holidays: { he: string; en: string }[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toHDate(date: LocalDate): HDate {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const js = new Date(y, mo - 1, d);
  if (js.getFullYear() !== y || js.getMonth() !== mo - 1 || js.getDate() !== d) {
    throw new RangeError(`Invalid date "${date}"`);
  }
  return new HDate(js);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const g = toHDate(date).add(days, 'd').greg();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`;
}

function israelEvents(hd: HDate): Event[] {
  return HebrewCalendar.getHolidaysOnDate(hd, true) ?? [];
}

const has = (events: Event[], flag: number) => events.some((e) => (e.getFlags() & flag) !== 0);
const named = (events: Event[], desc: string) => events.some((e) => e.getDesc() === desc);

export function dayInfo(date: LocalDate): DayInfo {
  const hd = toHDate(date);
  const today = israelEvents(hd);
  const tomorrow = israelEvents(hd.next());
  const weekday = hd.getDay();
  const isYomKippur = named(today, 'Yom Kippur');
  const isTishaBav = named(today, "Tish'a B'Av");
  return {
    date,
    weekday,
    isShabbat: weekday === 6,
    isErevShabbat: weekday === 5,
    isYomTov: has(today, flags.CHAG),
    isYomKippur,
    isErevChag: has(tomorrow, flags.CHAG),
    isCholHaMoed: has(today, flags.CHOL_HAMOED),
    isMajorFast: isYomKippur || isTishaBav,
    isTishaBav,
    isYomHaZikaron: named(today, 'Yom HaZikaron'),
    isYomHaZikaronEve: named(tomorrow, 'Yom HaZikaron'),
    isYomHaAtzmaut: named(today, "Yom HaAtzma'ut"),
    holidays: today
      .filter(
        (e) => (e.getFlags() & (flags.HEBREW_DATE | flags.PARSHA_HASHAVUA | flags.DAF_YOMI)) === 0,
      )
      .map((e) => ({ he: e.render('he-x-NoNikud'), en: e.render('en') })),
  };
}

/** Matches POLICIES.md §7 `calendar.*` keys. */
export interface CalendarPolicy {
  noLessonsOn: readonly NoLessonReason[];
  cholHaMoed: 'skip' | 'run';
}

export type NoLessonReason =
  | 'shabbat'
  | 'erev_chag'
  | 'yom_tov'
  | 'yom_kippur'
  | 'tisha_bav'
  | 'yom_hazikaron_evening'
  | 'yom_hazikaron'
  | 'yom_haatzmaut'
  | 'chol_hamoed'
  | 'override_closed';

export interface CalendarOverride {
  date: LocalDate;
  kind: 'closed' | 'open';
  reason: string;
}

export const DEFAULT_CALENDAR_POLICY: CalendarPolicy = {
  noLessonsOn: [
    'shabbat',
    'erev_chag',
    'yom_tov',
    'yom_kippur',
    'tisha_bav',
    'yom_hazikaron_evening',
  ],
  cholHaMoed: 'skip',
};

export interface LessonDayDecision {
  date: LocalDate;
  lessons: boolean;
  /** Every rule that blocked the day, for explainability. Empty when lessons run. */
  reasons: NoLessonReason[];
  /** Set when an owner override decided the outcome. */
  override?: CalendarOverride;
}

/**
 * Decides whether regular lessons run on a date. An explicit override always wins.
 * Note: `yom_hazikaron_evening` blocks the *eve* day (afternoon/evening lessons), since the memorial day starts at sundown.
 */
export function lessonDay(
  date: LocalDate,
  policy: CalendarPolicy = DEFAULT_CALENDAR_POLICY,
  overrides: readonly CalendarOverride[] = [],
): LessonDayDecision {
  const override = overrides.find((o) => o.date === date);
  if (override) {
    return override.kind === 'open'
      ? { date, lessons: true, reasons: [], override }
      : { date, lessons: false, reasons: ['override_closed'], override };
  }
  const info = dayInfo(date);
  const checks: [NoLessonReason, boolean][] = [
    ['shabbat', info.isShabbat],
    ['erev_chag', info.isErevChag],
    ['yom_tov', info.isYomTov],
    ['yom_kippur', info.isYomKippur],
    ['tisha_bav', info.isTishaBav],
    ['yom_hazikaron_evening', info.isYomHaZikaronEve],
    ['yom_hazikaron', info.isYomHaZikaron],
    ['yom_haatzmaut', info.isYomHaAtzmaut],
  ];
  const reasons = checks
    .filter(([r, hit]) => hit && policy.noLessonsOn.includes(r))
    .map(([r]) => r);
  if (policy.cholHaMoed === 'skip' && info.isCholHaMoed) reasons.push('chol_hamoed');
  return { date, lessons: reasons.length === 0, reasons };
}

/** "ט׳ בתשרי תשפ״ז" (Hebrew) or "9 Tishrei 5787" (English). */
export function hebrewDate(date: LocalDate, locale: 'he' | 'en' = 'he'): string {
  const hd = toHDate(date);
  return locale === 'he' ? hd.renderGematriya(true) : hd.render('en', true);
}

/** Today's local date in Israel. */
export function todayInIsrael(now: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

const JERUSALEM = Location.lookup('Jerusalem') as Location;
const CANDLE_LIGHTING_MIN_BEFORE_SUNSET = 40; // Jerusalem custom
const HAVDALAH_TZEIT_DEG = 8.5;

export interface Window {
  start: Date;
  end: Date;
}

/**
 * Times when nothing may be sent (Shabbat and Yom Tov), padded by `bufferMin` on both sides.
 * Covers a run of consecutive rest days (e.g. Yom Tov next to Shabbat) as one window.
 * Returns null if `date` is not inside or the eve of a rest day.
 */
export function restWindow(date: LocalDate, bufferMin = 30): Window | null {
  const isRest = (d: LocalDate) => {
    const i = dayInfo(d);
    return i.isShabbat || i.isYomTov;
  };
  let first: LocalDate;
  if (isRest(addDays(date, 1)) && !isRest(date)) first = addDays(date, 1);
  else if (isRest(date)) {
    first = date;
    while (isRest(addDays(first, -1))) first = addDays(first, -1);
  } else return null;
  let last = first;
  while (isRest(addDays(last, 1))) last = addDays(last, 1);

  const sunset = new Zmanim(JERUSALEM, toHDate(addDays(first, -1)), false).sunset();
  const tzeit = new Zmanim(JERUSALEM, toHDate(last), false).tzeit(HAVDALAH_TZEIT_DEG);
  const min = 60_000;
  return {
    start: new Date(sunset.getTime() - (CANDLE_LIGHTING_MIN_BEFORE_SUNSET + bufferMin) * min),
    end: new Date(tzeit.getTime() + bufferMin * min),
  };
}

export function isInRestWindow(instant: Date, bufferMin = 30): boolean {
  const local = todayInIsrael(instant);
  for (const d of [addDays(local, -1), local]) {
    const w = restWindow(d, bufferMin);
    if (w && instant >= w.start && instant <= w.end) return true;
  }
  return false;
}
