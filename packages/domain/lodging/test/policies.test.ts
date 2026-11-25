import { describe, expect, it } from 'vitest';
import {
  addDays,
  boardRows,
  botFacts,
  briefText,
  dayPlan,
  freeBeds,
  freeOptions,
  isFree,
  nightsBetween,
  roomNames,
  soldByFor,
  stayProblem,
  type RoomFacts,
  type StayFacts,
} from '../src/policies';

const room = (over: Partial<RoomFacts> & { id: string }): RoomFacts => ({
  name: over.id,
  kind: 'family',
  soldBy: 'room',
  pricePer: 'room',
  maxGuests: 4,
  priceNightAgorot: 40_000,
  toilet: 'private',
  shower: 'private',
  housekeeping: 'clean',
  active: true,
  beds: [{ id: `${over.id}-b1`, label: '1' }],
  ...over,
});
const dorm = room({
  id: 'dorm',
  name: 'דורמס',
  kind: 'dorm',
  soldBy: 'bed',
  maxGuests: 3,
  priceNightAgorot: 9_000,
  toilet: 'shared',
  shower: 'shared',
  beds: [
    { id: 'd1', label: '1' },
    { id: 'd2', label: '2' },
    { id: 'd3', label: '3' },
  ],
});
const fam = room({ id: 'fam', name: 'משפחתי 1' });
const fam2 = room({ id: 'fam2', name: 'משפחתי 2', priceNightAgorot: null });
const single = room({
  id: 'single',
  name: 'יחיד',
  kind: 'single',
  maxGuests: 1,
  priceNightAgorot: 25_000,
});

let n = 0;
const stay = (over: Partial<StayFacts> & { roomId: string }): StayFacts => ({
  id: `s${++n}`,
  bedId: null,
  guestName: 'אורח',
  guests: 2,
  checkIn: '2026-12-01',
  checkOut: '2026-12-03',
  status: 'confirmed',
  ...over,
});

describe('rooms', () => {
  it('sells a dorm by the bed and everything else whole', () => {
    expect(soldByFor('dorm')).toBe('bed');
    expect(soldByFor('family')).toBe('room');
  });
  it('numbers rooms added together and keeps a single name', () => {
    expect(roomNames('חדר', 1)).toEqual(['חדר']);
    expect(roomNames('חדר', 3)).toEqual(['חדר 1', 'חדר 2', 'חדר 3']);
    expect(roomNames('חדר', 2, 5)).toEqual(['חדר 5', 'חדר 6']);
  });
  it('counts days and nights', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(nightsBetween('2026-12-01', '2026-12-04')).toBe(3);
  });
});

describe('availability', () => {
  const nights = { checkIn: '2026-12-02', checkOut: '2026-12-04' };
  it('frees a room the day its guest leaves', () => {
    const stays = [stay({ roomId: 'fam', checkOut: '2026-12-02' })];
    expect(isFree(fam, null, nights, stays)).toBe(true);
  });
  it('blocks overlapping nights, ignores cancelled stays and the stay being changed', () => {
    const s = stay({ roomId: 'fam' });
    expect(isFree(fam, null, nights, [s])).toBe(false);
    expect(isFree(fam, null, nights, [s], s.id)).toBe(true);
    expect(isFree(fam, null, nights, [{ ...s, status: 'cancelled' }])).toBe(true);
    expect(isFree(fam, null, nights, [stay({ roomId: 'fam2' })])).toBe(true);
  });
  it('lets two beds of a dorm be booked, but not a whole dorm over a bed', () => {
    const s = stay({ roomId: 'dorm', bedId: 'd1', guests: 1 });
    expect(isFree(dorm, 'd2', nights, [s])).toBe(true);
    expect(isFree(dorm, 'd1', nights, [s])).toBe(false);
    expect(isFree(dorm, null, nights, [s])).toBe(false);
    expect(isFree(dorm, 'd2', nights, [stay({ roomId: 'dorm' })])).toBe(false);
    expect(freeBeds(dorm, nights, [s]).map((b) => b.id)).toEqual(['d2', 'd3']);
  });

  it('explains why a stay cannot be booked', () => {
    const ask = { bedId: null, guests: 2, ...nights };
    expect(stayProblem(fam, { ...ask, checkOut: '2026-12-02' }, [])).toBe('lodging.errors.dates');
    expect(stayProblem(fam, { ...ask, checkOut: '2027-03-01' }, [])).toBe('lodging.errors.tooLong');
    expect(stayProblem({ ...fam, active: false }, ask, [])).toBe('lodging.errors.roomClosed');
    expect(stayProblem(fam, { ...ask, guests: 5 }, [])).toBe('lodging.errors.tooManyGuests');
    expect(stayProblem(fam, ask, [stay({ roomId: 'fam' })])).toBe('lodging.errors.taken');
    expect(stayProblem(fam, ask, [])).toBeNull();
    expect(
      stayProblem(dorm, { ...ask, guests: 3 }, [stay({ roomId: 'dorm', bedId: 'd1', guests: 1 })]),
    ).toBe('lodging.errors.notEnoughBeds');
    expect(stayProblem(dorm, { ...ask, guests: 2 }, [])).toBeNull();
    expect(stayProblem(dorm, { ...ask, bedId: 'd2', guests: 1 }, [])).toBeNull();
  });

  it('offers free rooms and dorm beds that hold the guests, cheapest first and unpriced last', () => {
    const stays = [stay({ roomId: 'fam' }), stay({ roomId: 'dorm', bedId: 'd1', guests: 1 })];
    const all = [fam, fam2, single, dorm, room({ id: 'closed', active: false })];
    const two = freeOptions(all, stays, { ...nights, guests: 2 });
    expect(two.map((o) => [o.roomId, o.totalAgorot, o.room])).toEqual([
      ['dorm', 36_000, 2],
      ['fam2', null, 4],
    ]);
    expect(two[0]?.bedIds).toEqual(['d2', 'd3']);
    const one = freeOptions(all, [], { ...nights, guests: 1 });
    expect(one.map((o) => o.roomId)).toEqual(['dorm', 'single', 'fam', 'fam2']);
    expect(freeOptions(all, [], { ...nights, guests: 4 }).map((o) => o.roomId)).toEqual([
      'fam',
      'fam2',
    ]);
    expect(freeOptions(all, [], { ...nights, checkOut: nights.checkIn, guests: 1 })).toEqual([]);
    // Two unpriced rooms fall back to their names.
    const a = room({ id: 'a', name: 'א', priceNightAgorot: null });
    const b = room({ id: 'b', name: 'ב', priceNightAgorot: null });
    expect(freeOptions([b, a], [], { ...nights, guests: 1 }).map((o) => o.roomId)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('the board', () => {
  it('draws a row per room and per dorm bed with runs of free nights and stays', () => {
    const stays = [
      stay({ roomId: 'fam', checkIn: '2026-11-29', checkOut: '2026-12-02' }),
      stay({ roomId: 'fam', checkIn: '2026-12-03', checkOut: '2026-12-09' }),
      stay({
        roomId: 'dorm',
        bedId: 'd2',
        guests: 1,
        checkIn: '2026-12-02',
        checkOut: '2026-12-03',
      }),
      stay({ roomId: 'dorm', checkIn: '2026-12-04', checkOut: '2026-12-05', guests: 3 }),
      stay({ roomId: 'fam2', status: 'cancelled' }),
      stay({ roomId: 'fam2', checkIn: '2026-12-10', checkOut: '2026-12-12' }),
    ];
    const rows = boardRows(
      [fam, fam2, dorm, room({ id: 'x', active: false })],
      stays,
      '2026-12-01',
      5,
    );
    expect(rows.map((r) => [r.roomId, r.bedId])).toEqual([
      ['fam', null],
      ['fam2', null],
      ['dorm', 'd1'],
      ['dorm', 'd2'],
      ['dorm', 'd3'],
    ]);
    const famRow = rows[0]!.segments.map((s) => [
      s.start,
      s.length,
      s.stay?.id ?? null,
      s.before,
      s.after,
    ]);
    expect(famRow).toEqual([
      [0, 1, stays[0]!.id, true, false],
      [1, 1, null, false, false],
      [2, 3, stays[1]!.id, false, true],
    ]);
    expect(rows[1]!.segments).toEqual([
      { start: 0, length: 5, stay: null, before: false, after: false },
    ]);
    expect(rows[3]!.segments.map((s) => [s.start, s.length, s.stay?.id ?? null])).toEqual([
      [0, 1, null],
      [1, 1, stays[2]!.id],
      [2, 1, null],
      [3, 1, stays[3]!.id],
      [4, 1, null],
    ]);
  });
  it('does not mark a stay that ends exactly on the last night shown as going on', () => {
    const s = stay({ roomId: 'fam', checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const [row] = boardRows([fam], [s], '2026-12-01', 2);
    expect(row!.segments).toEqual([{ start: 0, length: 2, stay: s, before: false, after: false }]);
  });
});

describe('the day', () => {
  const today = '2026-12-05';
  const leaves = stay({
    roomId: 'fam',
    guestName: 'כהן',
    checkIn: '2026-12-02',
    checkOut: today,
    status: 'checked_in',
  });
  const comes = stay({
    roomId: 'fam',
    guestName: 'לוי',
    guests: 3,
    checkIn: today,
    checkOut: '2026-12-07',
  });
  const leaves2 = stay({
    roomId: 'single',
    guestName: 'דנה',
    guests: 1,
    checkIn: '2026-12-03',
    checkOut: today,
  });
  const dormBed = stay({
    roomId: 'dorm',
    bedId: 'd1',
    guestName: 'נועם',
    guests: 1,
    checkIn: today,
    checkOut: '2026-12-06',
    status: 'held',
  });
  const staying = stay({
    roomId: 'fam2',
    guestName: 'ברק',
    checkIn: '2026-12-04',
    checkOut: '2026-12-08',
    status: 'checked_in',
  });
  const gone = stay({
    roomId: 'fam2',
    guestName: 'עבר',
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    status: 'checked_out',
  });

  it('lists arrivals, departures, guests tonight and rooms to prepare, urgent first', () => {
    const dirty = room({ id: 'dirty', name: 'א מלוכלך', housekeeping: 'dirty' });
    const broken = room({ id: 'broken', housekeeping: 'out_of_order' });
    const rooms = [fam, fam2, single, dorm, dirty, broken, room({ id: 'closed', active: false })];
    const plan = dayPlan(rooms, [leaves, comes, leaves2, dormBed, staying, gone], today);
    expect(plan.arrivals.map((s) => s.guestName)).toEqual(['נועם', 'לוי']);
    expect(plan.departures.map((s) => s.guestName)).toEqual(['דנה', 'כהן']);
    expect(plan.inHouse.map((s) => s.guestName).sort()).toEqual(['ברק', 'לוי', 'נועם'].sort());
    expect(plan.toPrepare).toEqual([
      { roomId: 'fam', roomName: 'משפחתי 1', why: 'turnover', arrivalToday: true },
      { roomId: 'single', roomName: 'יחיד', why: 'departure', arrivalToday: false },
      { roomId: 'dirty', roomName: 'א מלוכלך', why: 'dirty', arrivalToday: false },
    ]);
    // Units: fam, fam2, single, dirty, broken (5 rooms) + 3 dorm beds; taken: fam, fam2, one bed.
    expect([plan.occupiedTonight, plan.unitsTonight]).toEqual([3, 8]);
  });

  it('counts a dorm booked whole as all its beds, and sorts rooms of the same urgency by name', () => {
    const whole = stay({ roomId: 'dorm', guests: 3, checkIn: today, checkOut: '2026-12-06' });
    const b = room({ id: 'b', name: 'ב', housekeeping: 'dirty' });
    const a = room({ id: 'a', name: 'א', housekeeping: 'dirty' });
    const plan = dayPlan([dorm, b, a], [whole], today);
    expect(plan.occupiedTonight).toBe(3);
    expect(plan.toPrepare.map((p) => p.roomId)).toEqual(['a', 'b']);
    // A stay in a room the list does not know still sorts.
    expect(
      dayPlan(
        [],
        [stay({ roomId: 'gone', checkIn: today }), stay({ roomId: 'gone2', checkIn: today })],
        today,
      ).arrivals,
    ).toHaveLength(2);
  });

  it('writes the morning WhatsApp in Hebrew and English', () => {
    const rooms = [fam, fam2, single, dorm];
    const plan = dayPlan(rooms, [leaves, comes, dormBed, staying], today);
    const he = briefText(plan, rooms, { checkIn: '15:00', checkOut: '11:00' }, 'he');
    expect(he).toContain('🛏️ לינה היום (05.12.2026)');
    expect(he).toContain('צ׳ק־אאוט (1) עד 11:00:\n• כהן, 2 אורחים — משפחתי 1');
    expect(he).toContain('• נועם, אורח אחד — דורמס, מיטה 1');
    expect(he).toContain('• משפחתי 1 — מתחלפים היום, להכין לפני ההגעה');
    expect(he).toContain('הלילה תפוסים 3 מתוך 6.');
    const en = briefText(
      dayPlan(rooms, [], today),
      rooms,
      { checkIn: '15:00', checkOut: '11:00' },
      'en',
    );
    expect(en).toContain('No arrivals and no departures today.');
    expect(en).toContain('Rooms to prepare (0):\nnone');
    const enFull = briefText(plan, rooms, { checkIn: '15:00', checkOut: '11:00' }, 'en');
    expect(enFull).toContain('Check-out (1) by 11:00:\n• כהן, 2 guests — משפחתי 1');
    expect(enFull).toContain('Check-in (2) from 15:00:');
    expect(enFull).toContain('• נועם, 1 guest — דורמס, bed 1');
    // A stay whose room is gone still prints.
    const odd = dayPlan([], [stay({ roomId: 'gone', checkIn: today, guests: 1 })], today);
    expect(briefText(odd, [], { checkIn: '14:00', checkOut: '10:00' }, 'en')).toContain(
      '• אורח, 1 guest — ',
    );
    const oddBed = dayPlan([], [stay({ roomId: 'gone', bedId: 'x', checkIn: today })], today);
    expect(briefText(oddBed, [], { checkIn: '14:00', checkOut: '10:00' }, 'he')).toContain('— \n');
  });
});

describe('the bot', () => {
  it('describes the rooms, or nothing without any', () => {
    expect(
      botFacts([room({ id: 'x', active: false })], { checkIn: '15:00', checkOut: '11:00' }),
    ).toEqual([]);
    expect(botFacts([fam], { checkIn: '15:00', checkOut: '11:00' })[1]).toMatch(
      /400.* a night \(base price\)\.$/,
    );
    const lines = botFacts([fam2, dorm], { checkIn: '15:00', checkOut: '11:00' });
    expect(lines[0]).toBe('Lodging on site: 2 rooms. Check-in from 15:00, check-out by 11:00.');
    expect(lines[1]).toContain('up to 4 guests; toilet private, shower private; price on request.');
    expect(lines[2]).toMatch(
      /^- דורמס \(dorm\): 3 beds sold one by one; toilet shared, shower shared; .*90.* a night per bed \(base price\)\.$/,
    );
    expect(lines.at(-1)).toContain('lodging_availability');
    expect(
      botFacts([fam], { checkIn: '15:00', checkOut: '11:00' }, [], 1, {
        percent: 25,
        holdHours: 12,
      })[1],
    ).toMatch(/^A booking is held for 12 hours until a deposit of 25%/);
  });
});
