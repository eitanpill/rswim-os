import type { MonthFacts } from '@rswim/domain-reports/policies';
import { describe, expect, it } from 'vitest';
import {
  aheadLines,
  DEFAULT_FORECAST_RULES as R,
  forecast,
  forecastLines,
  forecastRulesFrom,
  isReminderDay,
  warningText,
  type AheadDate,
  type ForecastInput,
  type ForecastWarning,
} from '../src/forecast-policies';

const month = (period: string, f: Partial<MonthFacts> = {}): MonthFacts => ({
  period,
  placesAtEnd: 100,
  newPlaces: 6,
  endedPlaces: 4,
  lessonsHeld: 80,
  lessonsCancelled: 0,
  marks: 400,
  absences: 40,
  trialsHeld: 5,
  trialsEnrolled: 3,
  chargedAgorot: 3_000_000,
  collectedAgorot: 2_850_000,
  venues: [],
  ...f,
});

const input = (f: Partial<ForecastInput> = {}): ForecastInput => ({
  today: '2026-11-27',
  history: [],
  placesNow: 100,
  ending: {},
  holidays: [],
  ...f,
});

const steady = ['2026-08', '2026-09', '2026-10'].map((p) => month(p));

describe('the forecast rules', () => {
  it('reads the policy section, falling back to the defaults, and puts a reversed window right', () => {
    expect(forecastRulesFrom(undefined)).toEqual(R);
    expect(forecastRulesFrom({ horizon_months: 2, enabled: false })).toMatchObject({
      horizonMonths: 2,
      enabled: false,
      dipPct: 10,
    });
    expect(forecastRulesFrom({ alert_min_days: 50, alert_max_days: 20 })).toMatchObject({
      alertMinDays: 20,
      alertMaxDays: 50,
    });
  });

  it('announces a date when it enters the window, half way and when it leaves', () => {
    expect([42, 28, 14].every((d) => isReminderDay(d, R))).toBe(true);
    expect(isReminderDay(30, R)).toBe(false);
  });
});

describe('the forecast', () => {
  it('says nothing about months it has no history for', () => {
    const f = forecast(input({ history: [month('2026-11')] }), R);
    expect(f.months).toHaveLength(3);
    expect(f.months.map((m) => m.period)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(f.months[0]).toMatchObject({
      basis: 'none',
      newPlaces: { low: 0, mid: 0, high: 0 },
      places: { low: 100, mid: 100, high: 100 },
      chargedAgorot: null,
      collectedAgorot: null,
      absencePct: null,
      lastYear: null,
    });
    expect(f).toMatchObject({
      recentPeriods: [],
      revenuePerPlaceAgorot: null,
      collectionPct: null,
      growthPct: 100,
      warnings: [],
    });
    expect(forecastLines(f, 'he')).toEqual([]);
  });

  it('uses the recent months as ranges when last year is not remembered, with nothing to warn about', () => {
    const f = forecast(input({ history: [...steady].reverse() }), R);
    expect(f.recentPeriods).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(f.revenuePerPlaceAgorot).toBe(30_000);
    expect(f.collectionPct).toBe(95);
    const [next] = f.months;
    expect(next).toMatchObject({
      basis: 'recent',
      newPlaces: { low: 5, mid: 6, high: 7 },
      endedPlaces: { low: 3, mid: 4, high: 5 },
      places: { low: 100, mid: 102, high: 104 },
      chargedAgorot: { low: 3_000_000, mid: 3_060_000, high: 3_120_000 },
      collectedAgorot: { low: 2_850_000, mid: 2_907_000, high: 2_964_000 },
      absencePct: 10,
    });
    expect(f.warnings).toEqual([]);
    expect(forecastLines(f, 'he')).toEqual([
      '🔮 החודש הבא (12/2026): 100–104 מקומות, 5–7 מצטרפים, 3–5 עוזבים, חיוב ₪30,000–₪31,200.',
    ]);
    expect(forecastLines(f, 'en')[0]).toBe(
      '🔮 Next month (12/2026): 100–104 places, 5–7 joining, 3–5 leaving, ₪30,000–₪31,200 charged.',
    );
  });

  it('follows the same month last year, scaled by growth, counts known leavers and warns', () => {
    const history = [
      month('2025-10', { placesAtEnd: 50 }),
      month('2025-12', { newPlaces: 1, endedPlaces: 10, marks: 100, absences: 40 }),
      month('2026-01', { newPlaces: 0, endedPlaces: 8 }),
      month('2026-02', { newPlaces: 0, endedPlaces: 8, marks: 0, absences: 0 }),
      month('2026-08', { collectedAgorot: 1_500_000 }),
      month('2026-09', { collectedAgorot: 1_500_000 }),
      month('2026-10', { collectedAgorot: 1_500_000 }),
    ];
    const f = forecast(
      input({ history, placesNow: 30, ending: { '2026-11': 2, '2026-12': 25 } }),
      R,
    );
    expect(f.growthPct).toBe(200);
    expect(f.collectionPct).toBe(50);
    const [dec, jan, feb] = f.months;
    expect(dec).toMatchObject({
      basis: 'last_year',
      knownEnding: 25,
      newPlaces: { mid: 2 },
      endedPlaces: { low: 25, mid: 25 },
      absencePct: 40,
      lastYear: { newPlaces: 1, endedPlaces: 10, placesAtEnd: 100 },
    });
    expect(dec?.places.low).toBe(0);
    expect(jan?.endedPlaces.mid).toBe(16);
    expect(feb?.absencePct).toBe(10);
    expect(f.warnings.map((w) => w.kind)).toEqual([
      'places_drop',
      'churn_rise',
      'revenue_drop',
      'collection_low',
      'attendance_dip',
    ]);
    expect(f.warnings[0]).toMatchObject({
      period: '2027-02',
      params: { from: 30, to: 0, pct: 100 },
    });
    const lines = forecastLines(f, 'he');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('⚠️ צפויה ירידה במקומות: מ-30 היום לכ-0 עד 2/2027 (100%).');
  });

  it('shrinks growth to the bounds and leaves money out when nothing was charged', () => {
    const history = [
      month('2025-10', { placesAtEnd: 1000 }),
      ...steady.map((m) => ({ ...m, chargedAgorot: 0, collectedAgorot: 0, marks: 0, absences: 0 })),
    ];
    const f = forecast(input({ history, placesNow: 0 }), { ...R, horizonMonths: 1 });
    expect(f.growthPct).toBe(50);
    expect(f.months[0]).toMatchObject({ chargedAgorot: null, absencePct: null });
    expect(f.warnings).toEqual([]);
    expect(forecastLines(f, 'en')[0]).not.toContain('charged');
    expect(forecastLines(f, 'he')[0]).not.toContain('חיוב');
  });

  it('keeps growth at 100% when last year had no places', () => {
    const history = [month('2025-10', { placesAtEnd: 0 }), ...steady];
    expect(forecast(input({ history }), R).growthPct).toBe(100);
  });
});

describe('dates ahead', () => {
  const holidays = [
    { name: { he: 'חנוכה', en: 'Chanukah' }, date: '2026-12-15' },
    { name: { he: 'קרוב מדי', en: 'Too soon' }, date: '2026-12-01' },
  ];

  it('takes holidays in the window, nearest first, and the summer and school year when they come near', () => {
    const f = forecast(input({ holidays }), R);
    expect(f.ahead).toEqual([
      {
        kind: 'holiday',
        name: { he: 'חנוכה', en: 'Chanukah' },
        date: '2026-12-15',
        daysAway: 18,
        lastYear: null,
        usual: null,
        action: 'plan_makeups',
      },
    ]);
    const may = forecast(input({ today: '2026-05-25' }), R).ahead;
    expect(may.map((a) => [a.kind, a.date, a.daysAway])).toEqual([['summer', '2026-07-01', 37]]);
    expect(may[0]?.action).toBe('open_registration');
    const aug = forecast(input({ today: '2026-08-10' }), R).ahead;
    expect(aug.map((a) => a.kind)).toEqual(['school_year']);
  });

  it('compares with the same month last year and picks what to do', () => {
    const at = (dec: Partial<MonthFacts>, recent = steady) =>
      forecast(input({ holidays, history: [month('2025-12', dec), ...recent] }), R).ahead[0];
    const plain = at({});
    expect(plain).toMatchObject({
      action: 'plan_makeups',
      lastYear: { period: '2025-12', newPlaces: 6, endedPlaces: 4, absencePct: 10 },
      usual: { newPlaces: 6, endedPlaces: 4, absencePct: 10 },
    });
    expect(at({ endedPlaces: 9 })?.action).toBe('retain');
    expect(at({ absences: 120 })?.action).toBe('remind_attendance');
    expect(at({ marks: 0, absences: 0 })?.action).toBe('plan_makeups');
    const noMarks = steady.map((m) => ({ ...m, marks: 0, absences: 0 }));
    expect(at({ absences: 200 }, noMarks)?.usual?.absencePct).toBeNull();
    expect(at({ absences: 200 }, noMarks)?.action).toBe('plan_makeups');
  });

  it('reads as WhatsApp lines', () => {
    const a: AheadDate = {
      kind: 'holiday',
      name: { he: 'חנוכה', en: 'Chanukah' },
      date: '2026-12-15',
      daysAway: 18,
      lastYear: {
        period: '2025-12',
        newPlaces: 2,
        endedPlaces: 9,
        lessonsCancelled: 6,
        absencePct: 30,
      },
      usual: { newPlaces: 6, endedPlaces: 4, absencePct: 10 },
      action: 'retain',
    };
    expect(aheadLines(a, 'he')).toEqual([
      '📅 חנוכה בעוד 18 ימים (15/12).',
      '   באותו חודש בשנה שעברה: 2 הצטרפו, 9 עזבו, 6 שיעורים בוטלו.',
      '   בשנה שעברה עזבו אז יותר מהרגיל: כדאי לדבר עם המשפחות בסיכון לפני.',
    ]);
    expect(aheadLines(a, 'en')[0]).toBe('📅 Chanukah in 18 days (15/12).');
    expect(aheadLines(a, 'en')[1]).toContain('Same month last year: 2 joined');
    const none = { he: '', en: '' };
    const summer: AheadDate = {
      ...a,
      kind: 'summer',
      name: none,
      lastYear: null,
      action: 'open_registration',
    };
    expect(aheadLines(summer, 'he')).toEqual([
      '📅 הקיץ בעוד 18 ימים (15/12).',
      '   זה הזמן לפתוח הרשמה ולפנות ללידים ולמשפחות שעזבו.',
    ]);
    expect(aheadLines(summer, 'en')[0]).toContain('The summer');
    const year: AheadDate = { ...summer, kind: 'school_year', action: 'plan_makeups' };
    expect(aheadLines(year, 'he')[0]).toContain('שנת הלימודים החדשה');
    expect(aheadLines(year, 'en')[0]).toContain('The new school year');
    expect(aheadLines({ ...year, action: 'remind_attendance' }, 'en')[1]).toContain('reminder');
  });
});

describe('warnings as sentences', () => {
  const w = (
    kind: ForecastWarning['kind'],
    params: ForecastWarning['params'],
  ): ForecastWarning => ({
    kind,
    period: '2027-01',
    params,
  });

  it('writes money in shekels and months as M/YYYY', () => {
    expect(warningText(w('revenue_drop', { amount: 2_000_000, usual: 3_000_000 }), 'he')).toBe(
      'החיוב ב-1/2027 צפוי לרדת לכ-₪20,000 (בדרך כלל ₪30,000).',
    );
    expect(warningText(w('collection_low', { pct: 70, gap: 900_000 }), 'en')).toBe(
      'Only 70% of what is charged gets collected: about ₪9,000 may be missing in 1/2027.',
    );
    expect(warningText(w('churn_rise', { n: 9, usual: 4 }), 'he')).toBe(
      'ב-1/2027 צפויים לעזוב כ-9, יותר מהרגיל (4).',
    );
    expect(warningText(w('attendance_dip', { pct: 30, usual: 10 }), 'en')).toBe(
      'In 1/2027 last year 30% were absent (usually 10%).',
    );
    expect(warningText(w('places_drop', { from: 30, to: 20, pct: 33 }), 'en')).toBe(
      'Places are heading down: from 30 today to about 20 by 1/2027 (33%).',
    );
  });
});
