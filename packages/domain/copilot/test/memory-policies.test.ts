import { describe, expect, it } from 'vitest';
import { monthChange, type MonthFacts } from '@rswim/domain-reports/policies';
import {
  changeLines,
  eventText,
  memoryLine,
  periodFromWords,
  periodName,
  periodOf,
  rememberedText,
  rememberRequest,
  shiftPeriod,
  snapshotDue,
} from '../src/memory-policies';
import { fakeIntent } from '../src/policies';

describe('the owner asks the brain to remember', () => {
  it('reads the usual phrasings', () => {
    expect(rememberRequest('תזכור שמשפחת כהן משלמת תמיד באיחור')).toEqual({
      body: 'משפחת כהן משלמת תמיד באיחור',
    });
    expect(rememberRequest('תזכור ש משפחת כהן משלמת')).toEqual({ body: 'משפחת כהן משלמת' });
    expect(rememberRequest('זכור: הבריכה בעמק סגורה בחנוכה')).toEqual({
      body: 'הבריכה בעמק סגורה בחנוכה',
    });
    expect(rememberRequest('תרשום לך שדנה לא יכולה בימי ב׳')).toEqual({
      body: 'דנה לא יכולה בימי ב׳',
    });
    expect(rememberRequest('תזכרי כי ההורים של יואב גרושים')).toEqual({
      body: 'ההורים של יואב גרושים',
    });
    expect(rememberRequest('Remember that the pool heater broke in March')).toEqual({
      body: 'the pool heater broke in March',
    });
  });

  it('leaves other messages alone', () => {
    expect(rememberRequest('כן 12')).toBeNull();
    expect(rememberRequest('תזכור')).toBeNull();
    expect(rememberRequest('תזכור ש')).toBeNull();
    expect(rememberRequest('מתי השיעור?')).toBeNull();
  });

  it('keeps long notes to the limit and says it saved them', () => {
    expect(rememberRequest(`זכור: ${'א'.repeat(1200)}`)!.body).toHaveLength(1000);
    expect(rememberedText('קצר', 'he')).toContain('"קצר"');
    expect(rememberedText('x'.repeat(200), 'en')).toContain(`${'x'.repeat(117)}...`);
  });
});

describe('months', () => {
  it('moves between months', () => {
    expect(periodOf('2026-11-06')).toBe('2026-11');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-11', 2)).toBe('2027-01');
    expect(shiftPeriod('2026-11', -12)).toBe('2025-11');
  });

  it('names months the way the owner does', () => {
    const today = '2026-11-06';
    expect(periodFromWords('2026-04', today)).toBe('2026-04');
    expect(periodFromWords('ב-2026-04', today)).toBe('2026-04');
    expect(periodFromWords('החודש', today)).toBe('2026-11');
    expect(periodFromWords('בחודש הזה', today)).toBe('2026-11');
    expect(periodFromWords('בחודש שעבר', today)).toBe('2026-10');
    expect(periodFromWords('החודש הקודם', today)).toBe('2026-10');
    expect(periodFromWords('באפריל', today)).toBe('2026-04');
    expect(periodFromWords('נובמבר', today)).toBe('2026-11');
    expect(periodFromWords('דצמבר', today)).toBe('2025-12');
    expect(periodFromWords('היום', today)).toBeNull();
  });

  it('writes a month by name', () => {
    expect(periodName('2026-04', 'he')).toBe('אפריל 2026');
    expect(periodName('2026-04', 'en')).toBe('April 2026');
  });

  it('computes the running month daily and an ended month once more', () => {
    expect(snapshotDue('2026-11', '2026-11-06', undefined)).toEqual({ due: true, final: false });
    expect(snapshotDue('2026-11', '2026-11-06', { final: false })).toEqual({
      due: true,
      final: false,
    });
    expect(snapshotDue('2026-10', '2026-11-06', { final: false })).toEqual({
      due: true,
      final: true,
    });
    expect(snapshotDue('2026-10', '2026-11-06', undefined)).toEqual({ due: true, final: true });
    expect(snapshotDue('2026-10', '2026-11-06', { final: true })).toEqual({
      due: false,
      final: true,
    });
  });
});

describe('events and notes as sentences', () => {
  const ev = (kind: string, params: Record<string, string | number>) => ({
    code: `agent.memory.events.${kind}`,
    params,
  });

  it('writes every event', () => {
    expect(
      eventText(
        ev('closure', {
          from: '2026-04-01',
          until: '2026-04-02',
          venue: '',
          reason: 'תקלה',
          sessions: 7,
        }),
        'he',
      ),
    ).toBe('השיעורים בוטלו 2026-04-01–2026-04-02 בכל הבריכות: תקלה (7 שיעורים)');
    expect(
      eventText(
        ev('closure', { from: 'a', until: 'b', venue: 'עמק', reason: 'r', sessions: 1 }),
        'en',
      ),
    ).toContain('at עמק');
    expect(
      eventText(
        ev('substitute', { staff: 'דנה', group: 'כרישים', date: '2026-04-01', outcome: 'filled' }),
        'he',
      ),
    ).toContain('נמצא/ה מחליף/ה');
    expect(
      eventText(ev('substitute', { staff: 'D', group: 'G', date: 'd', outcome: 'weird' }), 'en'),
    ).toContain('weird');
    expect(eventText(ev('price_list', { name: 'תשפ"ז', from: '2026-09-01' }), 'he')).toContain(
      'מחירון חדש',
    );
    expect(eventText(ev('group_opened', { group: 'G', venue: 'V', from: 'f' }), 'en')).toContain(
      'opened',
    );
    expect(eventText(ev('group_closed', { group: 'G', venue: 'V', until: 'u' }), 'he')).toContain(
      'נסגרה',
    );
    // A param the event lacks reads as empty, never as "undefined".
    expect(eventText(ev('price_list', { from: 'f' }), 'en')).toBe('New price list "" from f');
    expect(eventText({ code: 'agent.memory.events.unknown', params: {} }, 'he')).toBe(
      'agent.memory.events.unknown',
    );
  });

  it('gives the model one line per memory', () => {
    expect(
      memoryLine(
        {
          kind: 'note',
          happenedOn: '2026-11-01',
          subjectLabel: 'כהן',
          body: 'משלמים באיחור',
          summary: null,
        },
        'he',
      ),
    ).toBe('2026-11-01 · כהן · משלמים באיחור');
    expect(
      memoryLine(
        {
          kind: 'event',
          happenedOn: '2026-11-01',
          subjectLabel: null,
          body: null,
          summary: ev('price_list', { name: 'N', from: 'f' }),
        },
        'en',
      ),
    ).toBe('2026-11-01 · New price list "N" from f');
  });
});

describe('comparisons as lines', () => {
  const month = (over: Partial<MonthFacts> = {}): MonthFacts => ({
    period: '2026-10',
    placesAtEnd: 110,
    newPlaces: 10,
    endedPlaces: 5,
    lessonsHeld: 80,
    lessonsCancelled: 0,
    marks: 0,
    absences: 0,
    trialsHeld: 6,
    trialsEnrolled: 3,
    chargedAgorot: 5_000_000,
    collectedAgorot: 4_500_000,
    venues: [],
    ...over,
  });

  it('shows each measure now and before', () => {
    const lines = changeLines(
      monthChange(month(), month({ placesAtEnd: 100, newPlaces: 12, lessonsCancelled: 0 })),
      'he',
    );
    expect(lines[0]).toBe('מקומות בסוף החודש: 110 (לפני: 100, +10%)');
    expect(lines[1]).toBe('הצטרפו: 10 (לפני: 12, -17%)');
    expect(lines.find((l) => l.startsWith('שיעורים שבוטלו'))).toBe('שיעורים שבוטלו: 0 (לפני: 0)');
    expect(lines.find((l) => l.startsWith('היעדרויות'))).toBe('היעדרויות (%): —');
    expect(lines.find((l) => l.startsWith('חויב'))).toBe('חויב (₪): 50,000 (לפני: 50,000, 0%)');
  });

  it('shows only now without an earlier month', () => {
    expect(changeLines(monthChange(month(), null), 'en')[0]).toBe('Places at month end: 110');
  });
});

describe('the demo chat understands memory', () => {
  const today = '2026-11-06';
  it('remembers, compares months and recalls', () => {
    expect(fakeIntent('תזכור שהבריכה בעמק נסגרת בחנוכה', today)).toEqual({
      kind: 'remember',
      body: 'הבריכה בעמק נסגרת בחנוכה',
    });
    expect(fakeIntent('איך היה החודש?', today)).toEqual({ kind: 'month', period: '2026-11' });
    expect(fakeIntent('מה קרה באפריל', today)).toEqual({ kind: 'month', period: '2026-04' });
    expect(fakeIntent('מה אתה זוכר על משפחת כהן?', today)).toEqual({
      kind: 'recall',
      query: 'משפחת כהן',
    });
    // A day is not a month: it still asks for lessons.
    expect(fakeIntent('מה קרה ב-2026-11-02', today)).toEqual({
      kind: 'lessons',
      date: '2026-11-02',
    });
  });
});
