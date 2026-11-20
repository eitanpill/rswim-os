import { describe, expect, it } from 'vitest';
import { coachPriorities, coachText, type CoachFacts } from '../src/coach-policies';

const base: CoachFacts = {
  weekOf: '2026-11-22',
  newPlaces: 4,
  endedPlaces: 1,
  collectedAgorot: 1_250_000,
  waiting: [],
  uncovered: 0,
  debts: { count: 0, amountAgorot: 0 },
  groups: [],
  lowOccupancyPct: 50,
  ahead: [],
  assistant: false,
  lastYear: null,
};
const waiting = [1, 2, 3, 4].map((ref) => ({ ref, summary: `פעולה ${ref}` }));

describe('the weekly coach', () => {
  it('ranks what waits, uncovered lessons, old debts and the emptiest group, three at most', () => {
    const f: CoachFacts = {
      ...base,
      waiting,
      uncovered: 2,
      debts: { count: 3, amountAgorot: 90_000 },
      groups: [
        { name: 'מלאה', held: 8, capacity: 8 },
        { name: 'חצי', held: 3, capacity: 8 },
        { name: 'ריקה', held: 1, capacity: 8 },
        { name: 'בלי מקומות', held: 0, capacity: 0 },
      ],
    };
    expect(coachPriorities(f).map((p) => p.kind)).toEqual(['waiting', 'uncovered', 'debts']);
    expect(coachPriorities(f)[0]).toMatchObject({ count: 4, top: waiting.slice(0, 3) });
    expect(coachPriorities({ ...f, waiting: [], uncovered: 0 })).toEqual([
      { kind: 'debts', count: 3, amountAgorot: 90_000 },
      { kind: 'empty_group', name: 'ריקה', held: 1, capacity: 8 },
    ]);
    expect(coachPriorities(base)).toEqual([]);
  });

  it('says nothing when there is nothing to say', () => {
    expect(coachText(base, 'he')).toBeNull();
  });

  it('writes the week with what to reply', () => {
    const f: CoachFacts = {
      ...base,
      waiting: waiting.slice(0, 1),
      uncovered: 2,
      debts: { count: 3, amountAgorot: 90_000 },
    };
    expect(coachText(f, 'he')).toBe(
      [
        '🧭 השבוע שלך (מ-22/11)',
        'בשבוע שעבר: 4 הצטרפו, 1 עזבו, נגבו ₪12,500.',
        '',
        'מה חשוב השבוע:',
        '1. 1 פעולות מחכות להחלטה שלך:',
        '   • פעולה 1: השיבו "כן 1" או "לא 1"',
        '2. 2 שיעורים השבוע בלי מדריך. בדיקת הבוקר פותחת לכל אחד חיפוש מחליף, לפי הרמה שקבעת.',
        '3. 3 משפחות חייבות ₪900 כבר זמן רב. הרשימה במסך הכספים.',
      ].join('\n'),
    );
    expect(coachText({ ...f, assistant: true }, 'he')).toContain('השיבו "מי חייב לנו?" לרשימה.');
    const en = coachText({ ...f, assistant: true }, 'en') as string;
    expect(en).toContain('Your week (from 22/11)');
    expect(en).toContain('reply "yes 1" or "no 1"');
    expect(en).toContain('2 lesson(s) this week have no instructor');
    expect(en).toContain('Reply "who owes us?"');
    expect(coachText(f, 'en')).toContain('The list is on the money screen.');
  });

  it('names an emptying group', () => {
    const f = { ...base, groups: [{ name: 'דולפינים', held: 2, capacity: 8 }] };
    expect(coachText(f, 'he')).toContain('1. הקבוצה דולפינים כמעט ריקה (2 מתוך 8).');
    expect(coachText(f, 'en')).toContain('1. The group דולפינים runs near empty (2 of 8).');
  });

  it('looks ahead to the next holiday, with last year when it is remembered', () => {
    const ahead = [{ name: 'פסח', date: '2027-04-22', daysAway: 20 }];
    expect(coachText({ ...base, ahead }, 'he')).toBe(
      [
        '🧭 השבוע שלך (מ-22/11)',
        'בשבוע שעבר: 4 הצטרפו, 1 עזבו, נגבו ₪12,500.',
        '',
        'מבט קדימה: פסח בעוד 20 ימים (22/4).',
      ].join('\n'),
    );
    const lastYear = { period: '2026-04', newPlaces: 2, endedPlaces: 5 };
    expect(coachText({ ...base, ahead, lastYear }, 'he')).toContain(
      'באותו חודש בשנה שעברה: 2 הצטרפו, 5 עזבו.',
    );
    const en = coachText({ ...base, ahead, lastYear }, 'en') as string;
    expect(en).toContain('Ahead: פסח in 20 days (22/4).');
    expect(en).toContain('The same month last year: 2 joined, 5 left.');
    expect(en).toContain('Last week: 4 joined, 1 left, ₪12,500 collected.');
  });
});
