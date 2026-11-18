import { describe, expect, it } from 'vitest';
import { dayPart, firstName, hourIL } from './day-part';

describe('greeting helpers', () => {
  it('splits the day into four parts', () => {
    expect(dayPart(6)).toBe('morning');
    expect(dayPart(11)).toBe('morning');
    expect(dayPart(12)).toBe('noon');
    expect(dayPart(17)).toBe('evening');
    expect(dayPart(22)).toBe('night');
    expect(dayPart(3)).toBe('night');
  });

  it('reads the hour in Israel, not the server zone', () => {
    // 2026-07-01 09:30 UTC is 12:30 in Israel (summer time).
    expect(hourIL(new Date('2026-07-01T09:30:00Z'))).toBe(12);
  });

  it('keeps only the first name', () => {
    expect(firstName('מיכל כהן (דמו)')).toBe('מיכל');
    expect(firstName(null)).toBe('');
  });
});
