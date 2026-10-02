import { describe, expect, it } from 'vitest';
import {
  addDays,
  DEFAULT_CALENDAR_POLICY,
  dayInfo,
  hebrewDate,
  isInRestWindow,
  lessonDay,
  restWindow,
  todayInIsrael,
} from '../src';

// Fixtures: 5787 (2026-27), Israel schedule.
describe('dayInfo', () => {
  it('flags Yom Kippur 5787 (2026-09-21) as Yom Tov and major fast', () => {
    const d = dayInfo('2026-09-21');
    expect(d.isYomTov).toBe(true);
    expect(d.isYomKippur).toBe(true);
    expect(d.isMajorFast).toBe(true);
    expect(d.holidays.map((h) => h.en)).toContain('Yom Kippur');
  });

  it('flags Erev Sukkot as erev chag and Sukkot II as Chol HaMoed', () => {
    expect(dayInfo('2026-09-25').isErevChag).toBe(true);
    expect(dayInfo('2026-09-27').isCholHaMoed).toBe(true);
    expect(dayInfo('2026-09-27').isYomTov).toBe(false);
  });

  it('treats Hoshana Raba as erev chag (Shmini Atzeret is next)', () => {
    expect(dayInfo('2026-10-02').isErevChag).toBe(true);
    expect(dayInfo('2026-10-03').isYomTov).toBe(true);
  });

  it("flags Tisha B'Av 5787 (2027-08-12)", () => {
    const d = dayInfo('2027-08-12');
    expect(d.isTishaBav).toBe(true);
    expect(d.isMajorFast).toBe(true);
  });

  it('flags Yom HaZikaron and its eve', () => {
    expect(dayInfo('2027-05-11').isYomHaZikaron).toBe(true);
    expect(dayInfo('2027-05-10').isYomHaZikaronEve).toBe(true);
  });

  it('gives Hebrew names without nikud', () => {
    expect(dayInfo('2027-04-22').holidays[0]?.he).toBe('פסח א׳');
  });

  it('knows weekdays', () => {
    const d = dayInfo('2026-10-04'); // Sunday
    expect(d.weekday).toBe(0);
    expect(d.isShabbat).toBe(false);
    expect(dayInfo('2026-10-09').isErevShabbat).toBe(true);
    expect(dayInfo('2026-10-10').isShabbat).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => dayInfo('2026-9-1')).toThrow(RangeError);
    expect(() => dayInfo('2026-02-30')).toThrow(RangeError);
  });
});

describe('lessonDay with default policy', () => {
  it('runs on a regular Sunday', () => {
    expect(lessonDay('2026-10-04')).toEqual({ date: '2026-10-04', lessons: true, reasons: [] });
  });

  it('skips every Chol HaMoed day of Sukkot 5787', () => {
    for (let d = '2026-09-27'; d <= '2026-10-01'; d = addDays(d, 1)) {
      expect(lessonDay(d).reasons).toContain('chol_hamoed');
    }
  });

  it('skips Yom Kippur, erev chag, Tisha B’Av, Shabbat and the eve of Yom HaZikaron', () => {
    expect(lessonDay('2026-09-21').reasons).toEqual(['yom_tov', 'yom_kippur']);
    expect(lessonDay('2026-09-25').reasons).toEqual(['erev_chag']);
    expect(lessonDay('2027-08-12').reasons).toEqual(['tisha_bav']);
    expect(lessonDay('2026-10-10').reasons).toEqual(['shabbat']);
    expect(lessonDay('2027-05-10').reasons).toEqual(['yom_hazikaron_evening']);
    // The memorial day itself and Independence Day are off only when the policy says so.
    expect(lessonDay('2027-05-11').lessons).toBe(true);
    const strict = {
      ...DEFAULT_CALENDAR_POLICY,
      noLessonsOn: [
        ...DEFAULT_CALENDAR_POLICY.noLessonsOn,
        'yom_hazikaron' as const,
        'yom_haatzmaut' as const,
      ],
    };
    expect(lessonDay('2027-05-11', strict).reasons).toEqual(['yom_hazikaron']);
    expect(dayInfo('2027-05-12').isYomHaAtzmaut).toBe(true);
    expect(lessonDay('2027-05-12', strict).reasons).toEqual(['yom_haatzmaut']);
  });

  it('lets camps run on Chol HaMoed when policy says run', () => {
    expect(lessonDay('2026-09-28', { noLessonsOn: [], cholHaMoed: 'run' }).lessons).toBe(true);
  });

  it('applies owner overrides first', () => {
    const open = lessonDay('2026-09-28', undefined, [
      { date: '2026-09-28', kind: 'open', reason: 'קייטנה' },
    ]);
    expect(open.lessons).toBe(true);
    expect(open.override?.reason).toBe('קייטנה');
    const closed = lessonDay('2026-10-04', undefined, [
      { date: '2026-10-04', kind: 'closed', reason: 'שיפוץ' },
    ]);
    expect(closed).toMatchObject({ lessons: false, reasons: ['override_closed'] });
  });
});

describe('rest windows (no-send times)', () => {
  it('covers a regular Shabbat from before candle lighting to after havdalah', () => {
    const w = restWindow('2026-10-09');
    expect(w).not.toBeNull();
    // Friday afternoon Israel time, Saturday evening Israel time
    expect(w!.start.toISOString()).toMatch(/^2026-10-09T1[3-5]:/);
    expect(w!.end.toISOString()).toMatch(/^2026-10-10T1[5-7]:/);
    expect(restWindow('2026-10-10')).toEqual(w);
  });

  it('joins Shmini Atzeret (Shabbat 2026-10-03) into one window starting Friday', () => {
    const w = restWindow('2026-10-03')!;
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-10-03');
  });

  it('spans two-day Rosh Hashana 5788 followed by Shabbat', () => {
    // RH 5788: Sat 2027-10-02 & Sun 2027-10-03; erev is Friday 2027-10-01
    const w = restWindow('2027-10-02')!;
    expect(w.start.toISOString().slice(0, 10)).toBe('2027-10-01');
    expect(w.end.toISOString().slice(0, 10)).toBe('2027-10-03');
    expect(restWindow('2027-10-03')).toEqual(w); // asking from the second day walks back
  });

  it('returns null on a regular weekday', () => {
    expect(restWindow('2026-10-06')).toBeNull();
  });

  it('answers whether an instant is blocked', () => {
    expect(isInRestWindow(new Date('2026-10-10T09:00:00Z'))).toBe(true); // Shabbat noon
    expect(isInRestWindow(new Date('2026-10-06T09:00:00Z'))).toBe(false); // Tuesday
    expect(isInRestWindow(new Date('2026-10-09T08:00:00Z'))).toBe(false); // Friday morning
  });
});

describe('formatting helpers', () => {
  it('renders Hebrew dates in both locales', () => {
    expect(hebrewDate('2026-10-01')).toBe('כ׳ תשרי תשפ״ז');
    expect(hebrewDate('2026-10-01', 'en')).toBe('20th of Tishrei, 5787');
  });
  it('knows the Israeli date even when UTC is still on the previous day', () => {
    expect(todayInIsrael(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02');
  });
});
