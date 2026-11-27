import { describe, expect, it } from 'vitest';
import {
  coachPriorities,
  coachReview,
  coachText,
  coachWins,
  reviewLine,
  type CoachFacts,
  type CoachPriority,
} from '../src/coach-policies';
import { DEFAULT_FORECAST_RULES, forecast } from '../src/forecast-policies';

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
    expect(coachPriorities(f)[0]).toMatchObject({
      count: 4,
      top: waiting.slice(0, 3),
      refs: [1, 2, 3, 4],
    });
    expect(coachPriorities({ ...f, waiting: [], uncovered: 0 })).toEqual([
      { kind: 'debts', count: 3, amountAgorot: 90_000, refs: [] },
      { kind: 'empty_group', name: 'ריקה', held: 1, capacity: 8 },
    ]);
    expect(coachPriorities(base)).toEqual([]);
  });

  it('says nothing when there is nothing to say', () => {
    expect(coachText(base, 'he')).toBeNull();
    const history = ['2026-08', '2026-09', '2026-10'].map((period) => ({
      period,
      placesAtEnd: 10,
      newPlaces: 0,
      endedPlaces: 0,
      lessonsHeld: 0,
      lessonsCancelled: 0,
      marks: 0,
      absences: 0,
      trialsHeld: 0,
      trialsEnrolled: 0,
      chargedAgorot: 0,
      collectedAgorot: 0,
      venues: [],
    }));
    const ahead = forecast(
      { today: '2026-11-27', history, placesNow: 10, ending: {}, holidays: [] },
      DEFAULT_FORECAST_RULES,
    );
    expect(coachText({ ...base, forecast: ahead }, 'he')).toContain(
      '\n\n🔮 החודש הבא (12/2026): 10 מקומות, 0 מצטרפים, 0 עוזבים.',
    );
    expect(coachText({ ...base, forecast: null }, 'he')).toBeNull();
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
        '✨ מה הלך טוב:',
        '• 3 מקומות יותר משבוע קודם.',
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
        '✨ מה הלך טוב:',
        '• 3 מקומות יותר משבוע קודם.',
        '• שום דבר לא מחכה לך וכל השיעורים מאוישים.',
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

  it('gives a priority the actions that carry it out, and one reply for all of them', () => {
    const f: CoachFacts = {
      ...base,
      waiting: [
        { ref: 7, summary: 'קישור לכהן', kind: 'payment_link' },
        { ref: 8, summary: 'קישור ללוי', kind: 'payment_link' },
        { ref: 9, summary: 'מחליף לשני', kind: 'substitute' },
        { ref: 10, summary: 'להעביר את נועה', kind: 'move_student' },
        { ref: 11, summary: 'להעביר את דן', kind: 'move_student' },
      ],
      uncovered: 1,
      debts: { count: 2, amountAgorot: 60_000 },
    };
    expect(coachPriorities(f)).toEqual([
      {
        kind: 'waiting',
        count: 2,
        top: [
          { ref: 10, summary: 'להעביר את נועה' },
          { ref: 11, summary: 'להעביר את דן' },
        ],
        refs: [10, 11],
      },
      { kind: 'uncovered', count: 1, refs: [9] },
      { kind: 'debts', count: 2, amountAgorot: 60_000, refs: [7, 8] },
    ]);
    const he = coachText(f, 'he') as string;
    expect(he).toContain('   👉 הכל בבת אחת: השיבו "כן 10 11"');
    expect(he).toContain('חיפושי מחליף מוכנים: השיבו "כן 9" כדי להתחיל.');
    expect(he).toContain('קישורי תשלום מוכנים: השיבו "כן 7 8" לשליחה.');
    const en = coachText(f, 'en') as string;
    expect(en).toContain('All at once: reply "yes 10 11"');
    expect(en).toContain('Substitute searches are ready: reply "yes 9" to start them.');
    expect(en).toContain('Payment links are ready: reply "yes 7 8" to send them.');
    // Without the priority they carry out, links and searches are just waiting actions.
    expect(
      coachPriorities({ ...f, uncovered: 0, debts: { count: 0, amountAgorot: 0 } })[0],
    ).toMatchObject({ kind: 'waiting', count: 5, refs: [7, 8, 9, 10, 11] });
    // At most ten numbers in one reply.
    const many = Array.from({ length: 12 }, (_, i) => ({ ref: i + 1, summary: `פעולה ${i + 1}` }));
    expect(coachPriorities({ ...base, waiting: many })[0]).toMatchObject({
      refs: many.slice(0, 10).map((a) => a.ref),
    });
  });

  it("checks last week's advice against this week", () => {
    const lastWeek: CoachPriority[] = [
      { kind: 'waiting', count: 3, top: [], refs: [1, 2, 3] },
      { kind: 'uncovered', count: 4, refs: [] },
      { kind: 'debts', count: 3, amountAgorot: 90_000, refs: [] },
      { kind: 'empty_group', name: 'דולפינים', held: 2, capacity: 8 },
    ];
    const f: CoachFacts = {
      ...base,
      lastWeek,
      waiting: [{ ref: 3, summary: 'פעולה 3' }],
      uncovered: 1,
      debts: { count: 2, amountAgorot: 40_000 },
      groups: [{ name: 'דולפינים', held: 3, capacity: 8 }],
    };
    expect(coachReview(f)).toEqual([
      { kind: 'waiting', before: 3, after: 1, verdict: 'better' },
      { kind: 'uncovered', before: 4, after: 1, verdict: 'better' },
      { kind: 'debts', before: 90_000, after: 40_000, verdict: 'better' },
      { kind: 'empty_group', name: 'דולפינים', before: 2, after: 3, verdict: 'better' },
    ]);
    const done: CoachFacts = {
      ...f,
      waiting: [],
      uncovered: 0,
      debts: { count: 0, amountAgorot: 0 },
      groups: [{ name: 'דולפינים', held: 6, capacity: 8 }],
    };
    expect(coachReview(done).map((r) => r.verdict)).toEqual(['done', 'done', 'done', 'done']);
    const stuck: CoachFacts = {
      ...f,
      waiting: [1, 2, 3].map((ref) => ({ ref, summary: '' })),
      uncovered: 5,
      debts: { count: 3, amountAgorot: 95_000 },
      groups: [{ name: 'דולפינים', held: 1, capacity: 8 }],
    };
    expect(coachReview(stuck).map((r) => r.verdict)).toEqual(['open', 'open', 'open', 'open']);
    // A group that stopped running has nothing left to judge it by.
    expect(
      coachReview({
        ...f,
        groups: [{ name: 'דולפינים', held: 0, capacity: 0 }],
        lastWeek: [
          { kind: 'empty_group', name: 'דולפינים', held: 2, capacity: 8 },
          { kind: 'waiting', count: 1, top: [{ ref: 3, summary: '' }], refs: [3] },
        ],
      }),
    ).toEqual([
      { kind: 'empty_group', name: 'דולפינים', before: 2, after: 0, verdict: 'gone' },
      { kind: 'waiting', before: 1, after: 1, verdict: 'open' },
    ]);
    expect(
      coachReview({ ...f, groups: [], lastWeek: [lastWeek[3] as CoachPriority] })[0],
    ).toMatchObject({
      verdict: 'gone',
    });
    expect(coachReview(base)).toEqual([]);
  });

  it('writes what went well and the check, and writes for the check alone', () => {
    const f: CoachFacts = {
      ...base,
      newPlaces: 1,
      endedPlaces: 1,
      prevCollectedAgorot: 1_000_000,
      lastWeek: [{ kind: 'debts', count: 3, amountAgorot: 90_000, refs: [] }],
    };
    expect(coachText(f, 'he')).toBe(
      [
        '🧭 השבוע שלך (מ-22/11)',
        'בשבוע שעבר: 1 הצטרפו, 1 עזבו, נגבו ₪12,500.',
        '',
        '✨ מה הלך טוב:',
        '• 1 מתוך 1 הדברים מהשבוע שעבר התקדמו.',
        '• נגבו ₪2,500 יותר מהשבוע שלפניו.',
        '• שום דבר לא מחכה לך וכל השיעורים מאוישים.',
        '',
        'מה שהצעתי בשבוע שעבר:',
        '✅ חובות ישנים: ₪900 אז, ₪0 עכשיו.',
      ].join('\n'),
    );
    const en = coachText(f, 'en') as string;
    expect(en).toContain("✨ What went well:\n• 1 of last week's 1 priorities moved forward.");
    expect(en).toContain('• ₪2,500 more collected than the week before.');
    expect(en).toContain('• Nothing waits for you and every lesson has an instructor.');
    expect(en).toContain("Last week's advice:\n✅ Old debts: ₪900 then, ₪0 now.");
    expect(coachWins({ ...base, newPlaces: 5, endedPlaces: 1 }, [], 'en')).toEqual([
      '4 more places than a week ago.',
      'Nothing waits for you and every lesson has an instructor.',
    ]);
    // Less collected, nothing joined, something waiting: nothing to praise.
    expect(
      coachWins(
        { ...base, newPlaces: 0, prevCollectedAgorot: 2_000_000, uncovered: 1 },
        [{ kind: 'uncovered', before: 1, after: 1, verdict: 'open' }],
        'he',
      ),
    ).toEqual([]);
  });

  it('writes each line of the check in both languages', () => {
    const lines = [
      { kind: 'waiting', before: 3, after: 1, verdict: 'better' },
      { kind: 'uncovered', before: 2, after: 2, verdict: 'open' },
      { kind: 'debts', before: 90_000, after: 0, verdict: 'done' },
      { kind: 'empty_group', name: 'כרישים', before: 2, after: 5, verdict: 'done' },
      { kind: 'empty_group', name: 'כרישים', before: 2, after: 0, verdict: 'gone' },
    ] as const;
    expect(lines.map((l) => reviewLine(l, 'he'))).toEqual([
      '↗️ פעולות שחיכו לך: 2 מתוך 3 הוחלטו.',
      '⏳ שיעורים בלי מדריך: 2 אז, 2 עכשיו.',
      '✅ חובות ישנים: ₪900 אז, ₪0 עכשיו.',
      '✅ הקבוצה כרישים: 2 ילדים אז, 5 עכשיו.',
      '• הקבוצה כרישים כבר לא פעילה.',
    ]);
    expect(lines.map((l) => reviewLine(l, 'en'))).toEqual([
      '↗️ Actions waiting for you: 2 of 3 decided.',
      '⏳ Lessons without an instructor: 2 then, 2 now.',
      '✅ Old debts: ₪900 then, ₪0 now.',
      '✅ The group כרישים: 2 children then, 5 now.',
      '• The group כרישים is no longer running.',
    ]);
  });
});
