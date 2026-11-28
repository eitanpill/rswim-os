import type { MonthFacts } from '@rswim/domain-reports/policies';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORECAST_RULES, forecast } from '../src/forecast-policies';
import {
  adviceTally,
  monthHadActivity,
  monthlyText,
  type MonthlyFacts,
} from '../src/monthly-policies';

const month = (period: string, f: Partial<MonthFacts> = {}): MonthFacts => ({
  period,
  placesAtEnd: 102,
  newPlaces: 8,
  endedPlaces: 5,
  lessonsHeld: 80,
  lessonsCancelled: 0,
  marks: 400,
  absences: 36,
  trialsHeld: 6,
  trialsEnrolled: 4,
  chargedAgorot: 3_060_000,
  collectedAgorot: 2_890_000,
  venues: [],
  ...f,
});

const base: MonthlyFacts = {
  period: '2026-11',
  facts: month('2026-11'),
  previous: null,
  lastYear: null,
  reviews: [],
  actions: { alone: 0, approved: 0, dismissed: 0, undone: 0 },
  forecast: null,
};

describe('the monthly report', () => {
  it('says nothing about an empty month', () => {
    const empty = month('2026-11', {
      placesAtEnd: 0,
      lessonsHeld: 0,
      chargedAgorot: 0,
      collectedAgorot: 0,
    });
    expect(monthHadActivity(empty)).toBe(false);
    expect(monthlyText({ ...base, facts: empty }, 'he')).toBeNull();
    expect(monthHadActivity({ ...empty, collectedAgorot: 1 })).toBe(true);
    expect(monthHadActivity({ ...empty, lessonsHeld: 1 })).toBe(true);
    expect(monthHadActivity({ ...empty, chargedAgorot: 1 })).toBe(true);
  });

  it('counts the advice that moved, leaving out what is gone', () => {
    expect(
      adviceTally([
        { kind: 'waiting', verdict: 'done', before: 2, after: 0 },
        { kind: 'debts', verdict: 'better', before: 9, after: 5 },
        { kind: 'uncovered', verdict: 'open', before: 1, after: 1 },
        { kind: 'empty_group', verdict: 'gone', before: 1, after: 0, name: 'x' },
      ]),
    ).toEqual({ total: 3, moved: 2, done: 1 });
  });

  it('writes the month against the month before and last year, the advice, the brain and what comes next', () => {
    const history = ['2026-08', '2026-09', '2026-10', '2026-11'].map((p) => month(p));
    const m: MonthlyFacts = {
      ...base,
      facts: month('2026-11', { lessonsCancelled: 4 }),
      previous: month('2026-10', { placesAtEnd: 99 }),
      lastYear: month('2025-11', { placesAtEnd: 92 }),
      reviews: [
        { kind: 'waiting', verdict: 'done', before: 2, after: 0 },
        { kind: 'debts', verdict: 'open', before: 9, after: 9 },
      ],
      actions: { alone: 12, approved: 6, dismissed: 2, undone: 1 },
      forecast: forecast(
        { today: '2026-12-01', history, placesNow: 102, ending: {}, holidays: [] },
        DEFAULT_FORECAST_RULES,
      ),
    };
    expect(monthlyText(m, 'he')).toBe(
      [
        '📊 סיכום נובמבר 2026',
        'מקומות: 102 בסוף החודש (+3 מהחודש הקודם, +10 מאותו חודש בשנה שעברה).',
        'הצטרפו 8, עזבו 5, 6 שיעורי ניסיון (4 נרשמו), 9% היעדרויות.',
        'חויבו ₪30,600, נגבו ₪28,900 (94%).',
        '80 שיעורים התקיימו, 4 בוטלו.',
        'העצות של המאמן: 1 מתוך 2 התקדמו (1 טופלו עד הסוף).',
        'המוח: 12 פעולות לבד, 6 אישרת, 2 דחית, 1 ביטלת.',
        '',
        '🔮 החודש הבא (1/2027): 102–108 מקומות, 6–10 מצטרפים, 4–6 עוזבים, חיוב ₪30,600–₪32,400.',
      ].join('\n'),
    );
    const en = monthlyText(m, 'en') as string;
    expect(en).toContain('📊 November 2026 in review');
    expect(en).toContain(
      'Places: 102 at month end (+3 on the month before, +10 on the same month last year).',
    );
    expect(en).toContain('8 joined, 5 left, 6 trials (4 enrolled), 9% absences.');
    expect(en).toContain('Charged ₪30,600, collected ₪28,900 (94%).');
    expect(en).toContain('80 lessons held, 4 cancelled.');
    expect(en).toContain("The coach's advice: 1 of 2 moved forward (1 done).");
    expect(en).toContain(
      'The brain: 12 done on its own, 6 you approved, 2 you dropped, 1 you took back.',
    );
    expect(en).toContain('🔮 Next month');
  });

  it('leaves out what it has no numbers for', () => {
    const quiet = month('2026-11', { marks: 0, absences: 0, chargedAgorot: 0, collectedAgorot: 0 });
    expect(monthlyText({ ...base, facts: quiet }, 'he')).toBe(
      [
        '📊 סיכום נובמבר 2026',
        'מקומות: 102 בסוף החודש.',
        'הצטרפו 8, עזבו 5, 6 שיעורי ניסיון (4 נרשמו).',
      ].join('\n'),
    );
    const collectedOnly = month('2026-11', { chargedAgorot: 0, collectedAgorot: 50_000 });
    expect(monthlyText({ ...base, facts: collectedOnly }, 'en')).toContain(
      'Charged ₪0, collected ₪500.',
    );
    const prevOnly = { ...base, previous: month('2026-10', { placesAtEnd: 110 }) };
    expect(monthlyText(prevOnly, 'he')).toContain('(-8 מהחודש הקודם)');
    const empty = forecast(
      { today: '2026-12-01', history: [], placesNow: 0, ending: {}, holidays: [] },
      DEFAULT_FORECAST_RULES,
    );
    expect(monthlyText({ ...base, forecast: empty }, 'he')).not.toContain('🔮');
  });
});
