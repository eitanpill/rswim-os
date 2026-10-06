import { describe, expect, it } from 'vitest';
import { migrationNoticeVars, weekdayWord, type MigrationNoticeFacts } from '../src/policies';

const notice = (price: MigrationNoticeFacts['price']): MigrationNoticeFacts => ({
  firstName: 'נועה',
  from: { group: 'גוש שלישי', venue: 'בריכת גוש', weekday: 2, time: '16:00' },
  to: { group: 'גוש שלישי', venue: 'קאנטרי ירושלים', weekday: 2, time: '16:30' },
  effectiveOn: '2027-01-05',
  price,
});

describe('weekdayWord', () => {
  it('names the weekday in both languages', () => {
    expect(weekdayWord(0, 'he')).toBe('יום ראשון');
    expect(weekdayWord(2, 'he')).toBe('יום שלישי');
    expect(weekdayWord(6, 'en')).toBe('Saturday');
  });
});

describe('migrationNoticeVars', () => {
  it('fills every variable the migration templates use', () => {
    expect(
      migrationNoticeVars(notice({ kind: 'same', before: 33000, after: 33000 }), 'he'),
    ).toEqual({
      student_name: 'נועה',
      from_group: 'גוש שלישי',
      from_venue: 'בריכת גוש',
      from_day: 'יום שלישי',
      from_time: '16:00',
      to_group: 'גוש שלישי',
      to_venue: 'קאנטרי ירושלים',
      to_day: 'יום שלישי',
      to_time: '16:30',
      date: 'יום שלישי 5.1',
      price_note: 'המחיר החודשי לא משתנה.',
    });
  });

  it('tells the family what the price will be', () => {
    const up = notice({ kind: 'up', before: 30000, after: 33000, delta: 3000 });
    expect(migrationNoticeVars(up, 'he').price_note).toBe('המחיר החודשי יהיה ₪330 במקום ₪300.');
    expect(migrationNoticeVars(up, 'en').price_note).toBe(
      'The monthly price will be ₪330 instead of ₪300.',
    );
    expect(
      migrationNoticeVars(notice({ kind: 'same', before: 1, after: 1 }), 'en').price_note,
    ).toBe('The monthly price stays the same.');
    expect(migrationNoticeVars(notice({ kind: 'unknown' }), 'he').price_note).toBe(
      'נעדכן לגבי המחיר בהמשך.',
    );
    expect(migrationNoticeVars(notice({ kind: 'unknown' }), 'en').price_note).toBe(
      'We will update you about the price.',
    );
  });
});
