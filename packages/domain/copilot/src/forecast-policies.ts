/**
 * Looking ahead (docs/AI-BRAIN.md, stage 7). Pure and transparent: every number comes from a rule the owner can read on
 * the forecast page, from the months the brain remembers (stage 5) and what is already known today.
 *
 * - **Three months ahead, as ranges**: who joins, who leaves, places at each month's end, what will be charged and
 *   collected. A month is based on the same month last year (scaled by how much the school grew since) when the brain
 *   remembers it, otherwise on the average of the last three months. Places already asked to end count as leaving.
 * - **Warnings**: places or income going down, more families leaving than usual, payments coming in short, a month whose
 *   attendance dropped last year.
 * - **Dates ahead**: holidays, the summer and the new school year 2 to 6 weeks away, against the same month last year,
 *   each with one thing to do now.
 */
import { absencePct, type MonthFacts } from '@rswim/domain-reports/policies';
import { shiftPeriod } from './memory-policies';

type Locale = 'he' | 'en';

export interface ForecastRules {
  enabled: boolean;
  /** How many months ahead. */
  horizonMonths: number;
  /** Dates ahead are announced between these many days before (6 weeks) and (2 weeks). */
  alertMaxDays: number;
  alertMinDays: number;
  /** A drop in places or income of this share is a warning. */
  dipPct: number;
  /** The range around the middle is at least this share of it. */
  rangePct: number;
  /** More than this share above the usual leavers is a warning. */
  churnRisePct: number;
  /** Collection below this share of what is charged is a warning. */
  collectionWarnPct: number;
  /** A month whose absences were this many points above the usual is a warning. */
  absenceRisePoints: number;
  /** The month the summer and the school year start (1-12). */
  summerMonth: number;
  schoolYearMonth: number;
}

export const DEFAULT_FORECAST_RULES: ForecastRules = {
  enabled: true,
  horizonMonths: 3,
  alertMaxDays: 42,
  alertMinDays: 14,
  dipPct: 10,
  rangePct: 15,
  churnRisePct: 50,
  collectionWarnPct: 85,
  absenceRisePoints: 10,
  summerMonth: 7,
  schoolYearMonth: 9,
};

/** The forecast's rules from the resolved policy's `forecast` section. */
export function forecastRulesFrom(section: Record<string, unknown> | undefined): ForecastRules {
  const s = section ?? {};
  const pick = <K extends keyof ForecastRules>(k: K, key: string): ForecastRules[K] =>
    (s[key] ?? DEFAULT_FORECAST_RULES[k]) as ForecastRules[K];
  const r: ForecastRules = {
    enabled: pick('enabled', 'enabled'),
    horizonMonths: pick('horizonMonths', 'horizon_months'),
    alertMaxDays: pick('alertMaxDays', 'alert_max_days'),
    alertMinDays: pick('alertMinDays', 'alert_min_days'),
    dipPct: pick('dipPct', 'dip_pct'),
    rangePct: pick('rangePct', 'range_pct'),
    churnRisePct: pick('churnRisePct', 'churn_rise_pct'),
    collectionWarnPct: pick('collectionWarnPct', 'collection_warn_pct'),
    absenceRisePoints: pick('absenceRisePoints', 'absence_rise_points'),
    summerMonth: pick('summerMonth', 'summer_month'),
    schoolYearMonth: pick('schoolYearMonth', 'school_year_month'),
  };
  // A window the wrong way round still means "between these two".
  if (r.alertMinDays > r.alertMaxDays)
    return { ...r, alertMinDays: r.alertMaxDays, alertMaxDays: r.alertMinDays };
  return r;
}

export interface Range {
  low: number;
  mid: number;
  high: number;
}

/** Where a month's numbers come from. */
export type ForecastBasis = 'last_year' | 'recent' | 'none';

export interface MonthForecast {
  period: string;
  basis: ForecastBasis;
  newPlaces: Range;
  endedPlaces: Range;
  /** Places at the month's end. */
  places: Range;
  /** Null until the brain remembers a month with charges. Agorot. */
  chargedAgorot: Range | null;
  collectedAgorot: Range | null;
  /** Expected absences in whole percent, when known. */
  absencePct: number | null;
  /** Places already asked to end in this month. */
  knownEnding: number;
  /** The same month last year, when remembered. */
  lastYear: Pick<MonthFacts, 'newPlaces' | 'endedPlaces' | 'placesAtEnd' | 'chargedAgorot'> | null;
}

export type ForecastWarningKind =
  'places_drop' | 'churn_rise' | 'revenue_drop' | 'collection_low' | 'attendance_dip';

export interface ForecastWarning {
  kind: ForecastWarningKind;
  period: string;
  /** i18n params for `agent.forecast.warnings.<kind>.title` and `.action`. */
  params: Record<string, string | number>;
}

export type AheadKind = 'holiday' | 'summer' | 'school_year';
export type AheadAction = 'plan_makeups' | 'open_registration' | 'retain' | 'remind_attendance';

export interface AheadDate {
  kind: AheadKind;
  /** The holiday's name; empty for the summer and the school year. */
  name: { he: string; en: string };
  date: string;
  daysAway: number;
  /** The same month last year and what is usual now, when the brain remembers them. */
  lastYear: {
    period: string;
    newPlaces: number;
    endedPlaces: number;
    lessonsCancelled: number;
    absencePct: number | null;
  } | null;
  usual: { newPlaces: number; endedPlaces: number; absencePct: number | null } | null;
  action: AheadAction;
}

export interface Forecast {
  asOf: string;
  placesNow: number;
  /** The months the averages come from (the last complete ones, oldest first). */
  recentPeriods: string[];
  /** Per place, from the recent months: what is charged (agorot) and the share collected (whole percent). */
  revenuePerPlaceAgorot: number | null;
  collectionPct: number | null;
  /** How much bigger (or smaller) the school is than a year ago, in percent of last year; 100 without last year. */
  growthPct: number;
  months: MonthForecast[];
  warnings: ForecastWarning[];
  ahead: AheadDate[];
}

export interface ForecastInput {
  today: string;
  /** The months the brain remembers (any order; the running month is left out by the forecast). */
  history: readonly MonthFacts[];
  placesNow: number;
  /** Places already asked to end, by the month they end in ("YYYY-MM"). */
  ending: Readonly<Record<string, number>>;
  /** Holidays with no lessons in the coming weeks (from the calendar), first day each. */
  holidays: readonly { name: { he: string; en: string }; date: string }[];
}

const avg = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** A count's range: the middle, give or take the larger of `rangePct` and half of how much the recent months moved. */
function countRange(mid: number, recent: readonly number[], rangePct: number): Range {
  const m = Math.max(0, Math.round(mid));
  const moved = recent.length ? (Math.max(...recent) - Math.min(...recent)) / 2 : 0;
  const s = Math.max(Math.ceil((m * rangePct) / 100), Math.ceil(moved), m > 0 ? 1 : 0);
  return { low: Math.max(0, m - s), mid: m, high: m + s };
}

const scale = (r: Range, k: number): Range => ({
  low: Math.round(r.low * k),
  mid: Math.round(r.mid * k),
  high: Math.round(r.high * k),
});

/** The next 1st of `month` (1-12) after today. */
function nextMonthStart(today: string, month: number): string {
  const y = Number(today.slice(0, 4));
  const d = `${y}-${String(month).padStart(2, '0')}-01`;
  return d > today ? d : `${y + 1}${d.slice(4)}`;
}

/** The forecast: months ahead with ranges, warnings and the dates ahead. */
export function forecast(input: ForecastInput, rules: ForecastRules): Forecast {
  const current = input.today.slice(0, 7);
  const complete = [...input.history]
    .filter((m) => m.period < current)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  const byPeriod = new Map(complete.map((m) => [m.period, m]));
  const recent = complete.slice(-3);
  const last = recent[recent.length - 1];
  const of = (k: 'newPlaces' | 'endedPlaces') => recent.map((m) => m[k]);

  // Growth: the last complete month against the same month a year before.
  const lastYearRef = last ? byPeriod.get(shiftPeriod(last.period, -12)) : undefined;
  const growth =
    last && lastYearRef && lastYearRef.placesAtEnd > 0
      ? clamp(last.placesAtEnd / lastYearRef.placesAtEnd, 0.5, 2)
      : 1;

  const placesSum = recent.reduce((n, m) => n + m.placesAtEnd, 0);
  const chargedSum = recent.reduce((n, m) => n + m.chargedAgorot, 0);
  const collectedSum = recent.reduce((n, m) => n + m.collectedAgorot, 0);
  const perPlace = placesSum > 0 && chargedSum > 0 ? chargedSum / placesSum : null;
  const collection =
    chargedSum > 0 ? Math.min(100, Math.round((collectedSum / chargedSum) * 100)) : null;
  const recentAbsence = recent.map(absencePct).filter((x): x is number => x !== null);
  const usualAbsence = recentAbsence.length ? Math.round(avg(recentAbsence)) : null;

  // This month's remaining leavers are already known; the forecast starts from the places after them.
  const startPlaces = Math.max(0, input.placesNow - (input.ending[current] ?? 0));
  let prev: Range = { low: startPlaces, mid: startPlaces, high: startPlaces };
  const months: MonthForecast[] = [];
  for (let i = 1; i <= rules.horizonMonths; i++) {
    const period = shiftPeriod(current, i);
    const ly = byPeriod.get(shiftPeriod(period, -12));
    const basis: ForecastBasis = ly ? 'last_year' : recent.length ? 'recent' : 'none';
    const base = (k: 'newPlaces' | 'endedPlaces') =>
      ly ? ly[k] * growth : recent.length ? avg(of(k)) : 0;
    const known = input.ending[period] ?? 0;
    const joining = countRange(base('newPlaces'), of('newPlaces'), rules.rangePct);
    const e = countRange(Math.max(base('endedPlaces'), known), of('endedPlaces'), rules.rangePct);
    const leaving: Range = { low: Math.max(e.low, known), mid: e.mid, high: e.high };
    const places: Range = {
      low: Math.max(0, prev.low + joining.low - leaving.high),
      mid: Math.max(0, prev.mid + joining.mid - leaving.mid),
      high: Math.max(0, prev.high + joining.high - leaving.low),
    };
    const charged = perPlace === null ? null : scale(places, perPlace);
    const lyAbsence = ly ? absencePct(ly) : null;
    months.push({
      period,
      basis,
      newPlaces: joining,
      endedPlaces: leaving,
      places,
      chargedAgorot: charged,
      // A known charge per place means something was charged, so the collected share is known too.
      collectedAgorot: charged === null ? null : scale(charged, (collection as number) / 100),
      absencePct: lyAbsence ?? usualAbsence,
      knownEnding: known,
      lastYear: ly
        ? {
            newPlaces: ly.newPlaces,
            endedPlaces: ly.endedPlaces,
            placesAtEnd: ly.placesAtEnd,
            chargedAgorot: ly.chargedAgorot,
          }
        : null,
    });
    prev = places;
  }

  const warnings: ForecastWarning[] = [];
  if (recent.length) {
    const end = months[months.length - 1] as MonthForecast;
    if (input.placesNow > 0) {
      const pct = Math.round(((input.placesNow - end.places.mid) / input.placesNow) * 100);
      if (pct >= rules.dipPct)
        warnings.push({
          kind: 'places_drop',
          period: end.period,
          params: { period: end.period, from: input.placesNow, to: end.places.mid, pct },
        });
    }
    const usualLeaving = avg(of('endedPlaces'));
    const churn = months.find(
      (m) =>
        m.endedPlaces.mid >= 3 &&
        m.endedPlaces.mid >= usualLeaving * (1 + rules.churnRisePct / 100),
    );
    if (churn)
      warnings.push({
        kind: 'churn_rise',
        period: churn.period,
        params: { period: churn.period, n: churn.endedPlaces.mid, usual: Math.round(usualLeaving) },
      });
    const usualCharged = (last as MonthFacts).chargedAgorot;
    const dip = months.find(
      (m) => m.chargedAgorot && m.chargedAgorot.mid < usualCharged * (1 - rules.dipPct / 100),
    );
    if (dip)
      warnings.push({
        kind: 'revenue_drop',
        period: dip.period,
        params: {
          period: dip.period,
          amount: (dip.chargedAgorot as Range).mid,
          usual: usualCharged,
        },
      });
    const next = months[0] as MonthForecast;
    if (next.chargedAgorot && (collection as number) < rules.collectionWarnPct)
      warnings.push({
        kind: 'collection_low',
        period: next.period,
        params: {
          period: next.period,
          pct: collection as number,
          gap: next.chargedAgorot.mid - (next.collectedAgorot as Range).mid,
        },
      });
    // On a last-year month without marks the usual stands in, so only a remembered month can stand out.
    const absent =
      usualAbsence === null
        ? undefined
        : months.find(
            (m) =>
              m.basis === 'last_year' &&
              (m.absencePct as number) >= usualAbsence + rules.absenceRisePoints,
          );
    if (absent)
      warnings.push({
        kind: 'attendance_dip',
        period: absent.period,
        params: {
          period: absent.period,
          pct: absent.absencePct as number,
          usual: usualAbsence as number,
        },
      });
  }

  return {
    asOf: input.today,
    placesNow: input.placesNow,
    recentPeriods: recent.map((m) => m.period),
    revenuePerPlaceAgorot: perPlace === null ? null : Math.round(perPlace),
    collectionPct: collection,
    growthPct: Math.round(growth * 100),
    months,
    warnings,
    ahead: aheadDates(input, rules, byPeriod, recent),
  };
}

/** Holidays, the summer and the new school year within the alert window, nearest first, each with what to do now. */
function aheadDates(
  input: ForecastInput,
  rules: ForecastRules,
  byPeriod: ReadonlyMap<string, MonthFacts>,
  recent: readonly MonthFacts[],
): AheadDate[] {
  const none = { he: '', en: '' };
  const candidates: { kind: AheadKind; name: { he: string; en: string }; date: string }[] = [
    ...input.holidays.map((h) => ({ kind: 'holiday' as const, ...h })),
    { kind: 'summer', name: none, date: nextMonthStart(input.today, rules.summerMonth) },
    { kind: 'school_year', name: none, date: nextMonthStart(input.today, rules.schoolYearMonth) },
  ];
  const usual = recent.length
    ? {
        newPlaces: Math.round(avg(recent.map((m) => m.newPlaces))),
        endedPlaces: Math.round(avg(recent.map((m) => m.endedPlaces))),
        absencePct: (() => {
          const xs = recent.map(absencePct).filter((x): x is number => x !== null);
          return xs.length ? Math.round(avg(xs)) : null;
        })(),
      }
    : null;
  const out: AheadDate[] = [];
  for (const c of candidates) {
    const daysAway = daysBetween(input.today, c.date);
    if (daysAway < rules.alertMinDays || daysAway > rules.alertMaxDays) continue;
    const period = shiftPeriod(c.date.slice(0, 7), -12);
    const ly = byPeriod.get(period);
    const lastYear = ly
      ? {
          period,
          newPlaces: ly.newPlaces,
          endedPlaces: ly.endedPlaces,
          lessonsCancelled: ly.lessonsCancelled,
          absencePct: absencePct(ly),
        }
      : null;
    let action: AheadAction = c.kind === 'holiday' ? 'plan_makeups' : 'open_registration';
    // A remembered month means remembered recent months too, so `usual` is there.
    if (lastYear) {
      const u = usual as NonNullable<typeof usual>;
      if (lastYear.endedPlaces >= Math.max(2, u.endedPlaces * 1.5)) action = 'retain';
      else if (
        lastYear.absencePct !== null &&
        u.absencePct !== null &&
        lastYear.absencePct >= u.absencePct + rules.absenceRisePoints
      )
        action = 'remind_attendance';
    }
    out.push({ ...c, daysAway, lastYear, usual, action });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

/** The days a date ahead is announced on WhatsApp: when it enters the window, half way, and when it leaves. */
export function isReminderDay(daysAway: number, rules: ForecastRules): boolean {
  return [
    rules.alertMaxDays,
    Math.round((rules.alertMaxDays + rules.alertMinDays) / 2),
    rules.alertMinDays,
  ].includes(daysAway);
}

// ─── WhatsApp text ──────────────────────────────────────────────────────────

const ils = (agorot: number) => `₪${Math.round(agorot / 100).toLocaleString('en-US')}`;
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const mY = (p: string) => `${Number(p.slice(5, 7))}/${p.slice(0, 4)}`;
const span = (r: Range, f: (n: number) => string = String) =>
  r.low === r.high ? f(r.mid) : `${f(r.low)}–${f(r.high)}`;

function aheadName(a: AheadDate, locale: Locale): string {
  if (a.kind === 'holiday') return a.name[locale];
  if (locale === 'en') return a.kind === 'summer' ? 'The summer' : 'The new school year';
  return a.kind === 'summer' ? 'הקיץ' : 'שנת הלימודים החדשה';
}

const ACTION: Record<AheadAction, Record<Locale, string>> = {
  plan_makeups: {
    he: 'כדאי להודיע למשפחות כבר עכשיו ולתכנן השלמות.',
    en: 'Tell the families now and plan makeups.',
  },
  open_registration: {
    he: 'זה הזמן לפתוח הרשמה ולפנות ללידים ולמשפחות שעזבו.',
    en: 'Time to open registration and reach out to leads and families who left.',
  },
  retain: {
    he: 'בשנה שעברה עזבו אז יותר מהרגיל: כדאי לדבר עם המשפחות בסיכון לפני.',
    en: 'More families than usual left then last year: talk to the families at risk before.',
  },
  remind_attendance: {
    he: 'בשנה שעברה היו אז הרבה היעדרויות: כדאי לשלוח תזכורת ולפתוח השלמות.',
    en: 'Many were absent then last year: send a reminder and open makeups.',
  },
};

/** One date ahead in a line or two: when, last year, what to do. */
export function aheadLines(a: AheadDate, locale: Locale): string[] {
  const en = locale === 'en';
  const lines = [
    en
      ? `📅 ${aheadName(a, locale)} in ${a.daysAway} days (${dm(a.date)}).`
      : `📅 ${aheadName(a, locale)} בעוד ${a.daysAway} ימים (${dm(a.date)}).`,
  ];
  if (a.lastYear)
    lines.push(
      en
        ? `   Same month last year: ${a.lastYear.newPlaces} joined, ${a.lastYear.endedPlaces} left, ${a.lastYear.lessonsCancelled} lessons cancelled.`
        : `   באותו חודש בשנה שעברה: ${a.lastYear.newPlaces} הצטרפו, ${a.lastYear.endedPlaces} עזבו, ${a.lastYear.lessonsCancelled} שיעורים בוטלו.`,
    );
  lines.push(`   ${ACTION[a.action][locale]}`);
  return lines;
}

const WARNING: Record<ForecastWarningKind, Record<Locale, string>> = {
  places_drop: {
    he: 'צפויה ירידה במקומות: מ-{from} היום לכ-{to} עד {period} ({pct}%).',
    en: 'Places are heading down: from {from} today to about {to} by {period} ({pct}%).',
  },
  churn_rise: {
    he: 'ב-{period} צפויים לעזוב כ-{n}, יותר מהרגיל ({usual}).',
    en: 'About {n} are expected to leave in {period}, more than usual ({usual}).',
  },
  revenue_drop: {
    he: 'החיוב ב-{period} צפוי לרדת לכ-{amount} (בדרך כלל {usual}).',
    en: 'Charges in {period} are heading down to about {amount} (usually {usual}).',
  },
  collection_low: {
    he: 'נגבה רק {pct}% ממה שחויב: ב-{period} עלולים לחסור כ-{gap} בקופה.',
    en: 'Only {pct}% of what is charged gets collected: about {gap} may be missing in {period}.',
  },
  attendance_dip: {
    he: 'ב-{period} בשנה שעברה {pct}% נעדרו (בדרך כלל {usual}%).',
    en: 'In {period} last year {pct}% were absent (usually {usual}%).',
  },
};

/** A warning as one sentence (money in shekels, months as M/YYYY). */
export function warningText(w: ForecastWarning, locale: Locale): string {
  const p: Record<string, string | number> = { ...w.params, period: mY(w.period) };
  for (const k of ['amount', 'usual', 'gap'] as const)
    if (w.kind !== 'churn_rise' && w.kind !== 'attendance_dip' && typeof p[k] === 'number')
      p[k] = ils(p[k]);
  return WARNING[w.kind][locale].replace(/\{(\w+)\}/g, (_, k: string) => String(p[k]));
}

/**
 * The forecast in a few lines for the weekly coach: next month's places and charges as ranges, the warnings, and the
 * nearest date ahead. Empty without history.
 */
export function forecastLines(f: Forecast, locale: Locale): string[] {
  const en = locale === 'en';
  const next = f.months[0];
  if (!next || next.basis === 'none') return [];
  const lines = [
    en
      ? `🔮 Next month (${mY(next.period)}): ${span(next.places)} places, ${span(next.newPlaces)} joining, ${span(next.endedPlaces)} leaving${next.chargedAgorot ? `, ${span(next.chargedAgorot, ils)} charged` : ''}.`
      : `🔮 החודש הבא (${mY(next.period)}): ${span(next.places)} מקומות, ${span(next.newPlaces)} מצטרפים, ${span(next.endedPlaces)} עוזבים${next.chargedAgorot ? `, חיוב ${span(next.chargedAgorot, ils)}` : ''}.`,
  ];
  for (const w of f.warnings.slice(0, 2)) lines.push(`⚠️ ${warningText(w, locale)}`);
  return lines;
}
