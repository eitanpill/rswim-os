import { describe, expect, it } from 'vitest';
import { botFacts, freeOptions, type RoomFacts } from '../src/policies';
import {
  applyRate,
  nightOfWeek,
  quoteStay,
  rateProblem,
  rulesForNight,
  seasonCovers,
  unitsFor,
  type PricedRoom,
  type RateFacts,
} from '../src/prices';

const rate = (over: Partial<RateFacts> & { id: string }): RateFacts => ({
  name: over.id,
  kind: 'season',
  startsOn: null,
  endsOn: null,
  yearly: false,
  nightsOfWeek: null,
  roomKind: null,
  mode: 'percent',
  priceNightAgorot: null,
  percent: 10,
  minNights: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const family: PricedRoom = {
  kind: 'family',
  soldBy: 'room',
  pricePer: 'room',
  priceNightAgorot: 50_000,
};
const none = new Map<string, string>();

// 2027-07-04 is a Sunday; Thursday 07-08 and Friday 07-09 are weekend nights.
const summer = rate({
  id: 'summer',
  name: 'קיץ',
  startsOn: '2027-07-01',
  endsOn: '2027-08-31',
  mode: 'percent',
  percent: 20,
  minNights: 2,
});
const weekend = rate({
  id: 'weekend',
  name: 'סוף שבוע',
  kind: 'weekend',
  nightsOfWeek: [4, 5],
  mode: 'percent',
  percent: 10,
});
const holiday = rate({
  id: 'holiday',
  name: 'חגים',
  kind: 'holiday',
  mode: 'fixed',
  priceNightAgorot: 90_000,
  minNights: 3,
});

describe('seasons', () => {
  it('covers its nights, once or every year, across the new year too', () => {
    expect(seasonCovers(summer, '2027-07-01')).toBe(true);
    expect(seasonCovers(summer, '2027-08-31')).toBe(true);
    expect(seasonCovers(summer, '2028-07-10')).toBe(false);
    expect(seasonCovers({ ...summer, yearly: true }, '2028-07-10')).toBe(true);
    expect(seasonCovers({ ...summer, yearly: true }, '2028-09-01')).toBe(false);
    const winter = { startsOn: '2026-12-20', endsOn: '2027-01-05', yearly: true };
    expect(seasonCovers(winter, '2029-12-25')).toBe(true);
    expect(seasonCovers(winter, '2030-01-03')).toBe(true);
    expect(seasonCovers(winter, '2030-02-01')).toBe(false);
    expect(seasonCovers({ startsOn: null, endsOn: null, yearly: false }, '2027-07-01')).toBe(false);
  });

  it('knows the night of the week', () => {
    expect(nightOfWeek('2027-07-04')).toBe(0);
    expect(nightOfWeek('2027-07-09')).toBe(5);
  });
});

describe('one night', () => {
  it('sets or moves a price, and leaves an unpriced room unpriced on a percent', () => {
    expect(applyRate(50_000, { mode: 'fixed', priceNightAgorot: 70_000, percent: null })).toBe(
      70_000,
    );
    expect(applyRate(null, { mode: 'fixed', priceNightAgorot: 70_000, percent: null })).toBe(
      70_000,
    );
    expect(applyRate(50_000, { mode: 'percent', priceNightAgorot: null, percent: 15 })).toBe(
      57_500,
    );
    expect(applyRate(33_333, { mode: 'percent', priceNightAgorot: null, percent: -10 })).toBe(
      30_000,
    );
    expect(applyRate(null, { mode: 'percent', priceNightAgorot: null, percent: 15 })).toBeNull();
    expect(applyRate(100, { mode: 'percent', priceNightAgorot: null, percent: null })).toBe(100);
  });

  it('takes the season, then a holiday over the weekend', () => {
    const rates = [summer, weekend, holiday];
    expect(rulesForNight(family, '2027-07-05', rates, none).map((r) => r.rate.id)).toEqual([
      'summer',
    ]);
    expect(rulesForNight(family, '2027-07-08', rates, none).map((r) => r.rate.id)).toEqual([
      'summer',
      'weekend',
    ]);
    const chag = new Map([['2027-07-08', 'ראש השנה']]);
    expect(rulesForNight(family, '2027-07-08', rates, chag)).toEqual([
      { rate: summer },
      { rate: holiday, holiday: 'ראש השנה' },
    ]);
    // A holiday night without a holiday rule still gets the weekend.
    expect(rulesForNight(family, '2027-07-08', [weekend], chag).map((r) => r.rate.id)).toEqual([
      'weekend',
    ]);
    // A weekend rule without its nights changes nothing.
    expect(rulesForNight(family, '2027-07-08', [{ ...weekend, nightsOfWeek: null }], none)).toEqual(
      [],
    );
  });

  it('prefers a rule for this kind of room, then the shorter season, then the newer one', () => {
    const forFamilies = rate({ ...summer, id: 'fam', roomKind: 'family' });
    const forDorms = rate({ ...summer, id: 'dorm', roomKind: 'dorm' });
    const august = rate({ ...summer, id: 'aug', startsOn: '2027-08-01' });
    const newer = rate({ ...summer, id: 'new', createdAt: '2026-06-01T00:00:00Z' });
    const paused = rate({ ...summer, id: 'off', roomKind: 'family', active: false });
    const pick = (rates: RateFacts[]) =>
      rulesForNight(family, '2027-08-10', rates, none)[0]?.rate.id;
    expect(pick([summer, forFamilies, forDorms])).toBe('fam');
    expect(pick([summer, august])).toBe('aug');
    expect(pick([summer, newer])).toBe('new');
    expect(pick([summer, paused])).toBe('summer');
    // Two holiday rules, or weekend rules without a season's dates: the newer one.
    const chag = new Map([['2027-08-10', 'חג']]);
    const older = rate({ ...holiday, id: 'old', createdAt: '2025-01-01T00:00:00Z' });
    expect(rulesForNight(family, '2027-08-10', [older, holiday], chag)[0]?.rate.id).toBe('holiday');
    const half = rate({ ...weekend, id: 'half', nightsOfWeek: [2], startsOn: '2027-01-01' });
    const plain = rate({
      ...weekend,
      id: 'plain',
      nightsOfWeek: [2],
      createdAt: '2027-01-01T00:00:00Z',
    });
    expect(rulesForNight(family, '2027-08-10', [half, plain], none)[0]?.rate.id).toBe('plain');
  });

  it('prices a whole room once, and a dorm or a per-guest room by the guest', () => {
    expect(unitsFor({ soldBy: 'room', pricePer: 'room' }, 4)).toBe(1);
    expect(unitsFor({ soldBy: 'room', pricePer: 'guest' }, 4)).toBe(4);
    expect(unitsFor({ soldBy: 'bed', pricePer: 'room' }, 3)).toBe(3);
  });
});

describe('a stay', () => {
  it('adds up its nights and asks for the longest minimum it touches', () => {
    const q = quoteStay(
      family,
      { checkIn: '2027-07-07', checkOut: '2027-07-10', guests: 4 },
      [summer, weekend],
      none,
    );
    // Wed: 500 + 20% = 600; Thu and Fri: 600 + 10% = 660.
    expect(q.nights.map((n) => n.agorot)).toEqual([60_000, 66_000, 66_000]);
    expect(q.totalAgorot).toBe(192_000);
    expect(q.nights[1]?.rules).toEqual([
      { id: 'summer', name: 'קיץ', kind: 'season' },
      { id: 'weekend', name: 'סוף שבוע', kind: 'weekend' },
    ]);
    expect([q.minNights, q.tooShort]).toEqual([2, false]);
    const chag = new Map([['2027-07-07', 'שבועות']]);
    const short = quoteStay(
      family,
      { checkIn: '2027-07-07', checkOut: '2027-07-08', guests: 2 },
      [summer, holiday],
      chag,
    );
    expect(short.nights[0]).toMatchObject({
      agorot: 90_000,
      rules: [{ id: 'summer' }, { id: 'holiday', holiday: 'שבועות' }],
    });
    expect([short.minNights, short.tooShort]).toEqual([3, true]);
  });

  it('keeps the business minimum, prices per guest, and has no total when a night is unpriced', () => {
    const perGuest: PricedRoom = { ...family, pricePer: 'guest', priceNightAgorot: 15_000 };
    const q = quoteStay(
      perGuest,
      { checkIn: '2027-03-01', checkOut: '2027-03-03', guests: 3 },
      [],
      none,
      3,
    );
    expect([q.totalAgorot, q.minNights, q.tooShort]).toEqual([90_000, 3, true]);
    const unpriced = quoteStay(
      { ...family, priceNightAgorot: null },
      { checkIn: '2027-07-30', checkOut: '2027-08-02', guests: 2 },
      [
        rate({
          id: 'aug',
          startsOn: '2027-08-01',
          endsOn: '2027-08-31',
          mode: 'fixed',
          priceNightAgorot: 40_000,
        }),
      ],
      none,
      0,
    );
    expect(unpriced.nights.map((n) => n.agorot)).toEqual([null, null, 40_000]);
    expect([unpriced.totalAgorot, unpriced.minNights]).toEqual([null, 1]);
    expect(
      quoteStay(family, { checkIn: '2027-07-02', checkOut: '2027-07-01', guests: 1 }, [], none)
        .nights,
    ).toEqual([]);
  });

  it('feeds the free rooms search, a stay too short for the price list last', () => {
    const room = (over: Partial<RoomFacts> & { id: string }): RoomFacts => ({
      name: over.id,
      kind: 'family',
      soldBy: 'room',
      pricePer: 'room',
      maxGuests: 4,
      priceNightAgorot: 30_000,
      toilet: 'private',
      shower: 'private',
      housekeeping: 'clean',
      active: true,
      beds: [{ id: `${over.id}-b1`, label: '1' }],
      ...over,
    });
    const cheapFamily = room({ id: 'a' });
    const double = room({ id: 'b', kind: 'double', priceNightAgorot: 40_000 });
    const familyMin = rate({ ...summer, id: 'min', roomKind: 'family', minNights: 3 });
    const options = freeOptions(
      [cheapFamily, double],
      [],
      { checkIn: '2027-07-05', checkOut: '2027-07-07', guests: 2 },
      { rates: [familyMin], holidays: none, minNights: 1 },
    );
    expect(options.map((o) => [o.roomId, o.totalAgorot, o.tooShort, o.minNights])).toEqual([
      ['b', 80_000, false, 1],
      ['a', 72_000, true, 3],
    ]);
    expect(options[1]?.priced[0]?.rules[0]?.id).toBe('min');
  });
});

describe('saving a rule', () => {
  const base = {
    kind: 'season' as const,
    startsOn: '2027-07-01',
    endsOn: '2027-08-31',
    nightsOfWeek: null,
    mode: 'percent' as const,
    priceNightAgorot: null,
    percent: 20,
  };
  it('wants a season with its dates, a weekend with its nights, and a price or a percent', () => {
    expect(rateProblem(base)).toBeNull();
    expect(rateProblem({ ...base, endsOn: null })).toBe('lodging.errors.rateDates');
    expect(rateProblem({ ...base, startsOn: null })).toBe('lodging.errors.rateDates');
    expect(rateProblem({ ...base, endsOn: '2027-06-01' })).toBe('lodging.errors.rateDates');
    expect(rateProblem({ ...base, kind: 'weekend', nightsOfWeek: [] })).toBe(
      'lodging.errors.rateNights',
    );
    expect(rateProblem({ ...base, kind: 'weekend', nightsOfWeek: null })).toBe(
      'lodging.errors.rateNights',
    );
    expect(rateProblem({ ...base, kind: 'holiday', percent: 0 })).toBe('lodging.errors.rateValue');
    expect(rateProblem({ ...base, percent: null })).toBe('lodging.errors.rateValue');
    expect(rateProblem({ ...base, mode: 'fixed' })).toBe('lodging.errors.rateValue');
    expect(rateProblem({ ...base, mode: 'fixed', priceNightAgorot: 0 })).toBeNull();
  });
});

describe('the bot hears the price list', () => {
  it('lists the rules, the minimum stay and per-guest prices', () => {
    const r: RoomFacts = {
      id: 'r',
      name: 'משפחתי',
      kind: 'family',
      soldBy: 'room',
      pricePer: 'guest',
      maxGuests: 4,
      priceNightAgorot: 15_000,
      toilet: 'private',
      shower: 'private',
      housekeeping: 'clean',
      active: true,
      beds: [],
    };
    const lines = botFacts(
      [r],
      { checkIn: '15:00', checkOut: '11:00' },
      [
        { ...summer, yearly: true },
        { ...weekend, roomKind: 'family' },
        holiday,
        rate({
          id: 'cheap',
          name: 'חורף',
          startsOn: '2027-01-01',
          endsOn: '2027-02-28',
          percent: -15,
        }),
        rate({ id: 'off', active: false, startsOn: '2027-01-01', endsOn: '2027-01-02' }),
        rate({ id: 'odd', kind: 'weekend', nightsOfWeek: null, percent: null }),
        rate({ id: 'oddFixed', kind: 'holiday', mode: 'fixed', priceNightAgorot: null }),
      ],
      2,
    );
    expect(lines[1]).toBe('Minimum stay: 2 nights.');
    expect(lines[2]).toContain('a night per guest (base price)');
    expect(lines).toContain('- קיץ: 2027-07-01 to 2027-08-31 every year: +20%, at least 2 nights.');
    expect(lines).toContain(
      '- סוף שבוע: weekend nights (4, 5; 0 = Sunday night) (family rooms): +10%.',
    );
    expect(
      lines.some(
        (l) =>
          l.startsWith('- חגים: Jewish holiday nights: ') && l.endsWith(', at least 3 nights.'),
      ),
    ).toBe(true);
    expect(lines).toContain('- חורף: 2027-01-01 to 2027-02-28: -15%.');
    expect(lines.some((l) => l.startsWith('- off'))).toBe(false);
    expect(lines).toContain('- odd: weekend nights (; 0 = Sunday night): 0%.');
    expect(
      lines.some((l) => l.startsWith('- oddFixed: Jewish holiday nights: ') && l.includes('0')),
    ).toBe(true);
  });
});
