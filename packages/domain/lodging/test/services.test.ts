/**
 * Lodging against a throwaway database: rooms with their beds, booking whole rooms and dorm beds, the database refusing
 * a room or a bed sold twice, check-in and check-out (the room then waits to be made up), the morning brief, and the
 * bot's availability tool. Office only: an instructor sees nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import type { ServiceContext } from '@rswim/domain-core';
import { addDays } from '../src/policies';
import {
  addRooms,
  bookStay,
  addRate,
  getStay,
  holidayNights,
  holidaysAhead,
  loadRates,
  lodgingBoard,
  lodgingDay,
  loadRooms,
  moveStay,
  removeRate,
  saveLodgingSettings,
  setRateActive,
  searchFree,
  sendMorningBrief,
  setHousekeeping,
  updateRoom,
} from '../src/services';
import { lodgingLeadBotModule } from '../src/bot';

let t: TestDatabase;
let orgId: string;
let ownerId: string;
let instructorId: string;
let today: string;

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;

beforeAll(async () => {
  t = await createTestDatabase();
  [{ id: orgId }] = await q(
    `insert into organizations (slug, name) values ('inn', 'אכסניית בדיקה') returning id`,
  );
  await q(`insert into org_settings (organization_id) values ($1)`, [orgId]);
  [{ id: ownerId }] = await q(
    `insert into auth.users (email) values ('owner@inn.test') returning id`,
  );
  [{ id: instructorId }] = await q(
    `insert into auth.users (email) values ('coach@inn.test') returning id`,
  );
  await q(
    `insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'instructor')`,
    [orgId, ownerId, instructorId],
  );
  [{ d: today }] = await q(`select app.today()::text d`);
});
afterAll(async () => {
  await t.drop();
});

const asOwner = <T>(fn: (tx: Tx, ctx: ServiceContext) => Promise<T>) =>
  asUser(t.db, { sub: ownerId, org_id: orgId }, (tx) => fn(tx, { orgId, userId: ownerId }));

describe('lodging', () => {
  let family: string[];
  let dorm: string;

  it('adds rooms with their beds, several of a kind at once', async () => {
    family = await asOwner((tx, ctx) =>
      addRooms(tx, ctx, {
        name: 'משפחתי',
        kind: 'family',
        count: 2,
        beds: 3,
        maxGuests: 4,
        toilet: 'private',
        shower: 'private',
        priceNight: 45_000,
        note: null,
      }),
    );
    [dorm] = (await asOwner((tx, ctx) =>
      addRooms(tx, ctx, {
        name: 'דורמס',
        kind: 'dorm',
        count: 1,
        beds: 4,
        maxGuests: 9,
        toilet: 'shared',
        shower: 'shared',
        priceNight: 9_000,
        note: 'קומה 2',
      }),
    )) as [string];
    const rooms = await asOwner((tx) => loadRooms(tx));
    expect(rooms.map((r) => [r.name, r.soldBy, r.beds.length, r.maxGuests])).toEqual([
      ['משפחתי 1', 'room', 3, 4],
      ['משפחתי 2', 'room', 3, 4],
      ['דורמס', 'bed', 4, 4],
    ]);
  });

  it('books a whole room and refuses the same nights twice, also straight in the database', async () => {
    const [stay] = await asOwner((tx, ctx) =>
      bookStay(tx, ctx, {
        roomId: family[0]!,
        guestName: 'משפחת כהן',
        phone: '050-0000101',
        guests: 4,
        checkIn: today,
        checkOut: addDays(today, 2),
      }),
    );
    expect(stay).toBeTruthy();
    await expect(
      asOwner((tx, ctx) =>
        bookStay(tx, ctx, {
          roomId: family[0]!,
          guestName: 'משפחת לוי',
          guests: 2,
          checkIn: addDays(today, 1),
          checkOut: addDays(today, 3),
        }),
      ),
    ).rejects.toMatchObject({ code: 'lodging.errors.taken' });
    await expect(
      q(
        `insert into lodging_stays (organization_id, room_id, guest_name, guests, check_in, check_out)
         values ($1, $2, 'עוקף', 2, $3::date + 1, $3::date + 2)`,
        [orgId, family[0], today],
      ),
    ).rejects.toThrow(/lodging.errors.taken/);
    await expect(
      asOwner((tx, ctx) =>
        bookStay(tx, ctx, {
          roomId: family[1]!,
          guestName: 'רבים',
          guests: 6,
          checkIn: today,
          checkOut: addDays(today, 1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'lodging.errors.tooManyGuests' });
  });

  it('splits a group in the dorm into one stay per bed, and refuses more guests than free beds', async () => {
    const ids = await asOwner((tx, ctx) =>
      bookStay(tx, ctx, {
        roomId: dorm,
        guestName: 'קבוצת צוללים',
        guests: 3,
        checkIn: today,
        checkOut: addDays(today, 1),
        hold: 'on',
      }),
    );
    expect(ids).toHaveLength(3);
    const free = await asOwner((tx) =>
      searchFree(tx, { checkIn: today, checkOut: addDays(today, 1), guests: 2 }),
    );
    expect(free.map((o) => o.roomId)).toEqual([family[1]]);
    await expect(
      asOwner((tx, ctx) =>
        bookStay(tx, ctx, {
          roomId: dorm,
          guestName: 'עוד',
          guests: 2,
          checkIn: today,
          checkOut: addDays(today, 1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'lodging.errors.notEnoughBeds' });
    const stay = await asOwner((tx) => getStay(tx, ids[0]!));
    expect([stay?.status, stay?.bedLabel, stay?.totalAgorot]).toEqual(['held', '1', 9_000]);
    await expect(
      q(
        `insert into lodging_stays (organization_id, room_id, bed_id, guest_name, guests, check_in, check_out)
         select $1, $2, id, 'זוג במיטה', 2, $3::date + 3, $3::date + 4 from lodging_beds where room_id = $2 limit 1`,
        [orgId, dorm, today],
      ),
    ).rejects.toThrow(/lodging.errors.bedOneGuest/);
  });

  it('will not close a bed someone sleeps in', async () => {
    await expect(
      asOwner((tx, ctx) =>
        updateRoom(tx, ctx, {
          id: dorm,
          name: 'דורמס',
          kind: 'dorm',
          beds: 2,
          maxGuests: 2,
          toilet: 'shared',
          shower: 'shared',
          priceNight: 9_000,
          note: null,
          active: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'lodging.errors.bedInUse' });
    await asOwner((tx, ctx) =>
      updateRoom(tx, ctx, {
        id: dorm,
        name: 'דורמס גדול',
        kind: 'dorm',
        beds: 6,
        maxGuests: 6,
        toilet: 'shared',
        shower: 'private',
        priceNight: 8_000,
        note: null,
        active: true,
      }),
    );
    const rooms = await asOwner((tx) => loadRooms(tx));
    expect(rooms.find((r) => r.id === dorm)?.beds).toHaveLength(6);
  });

  it('checks guests in and out, leaves the room to clean, and shows the day and the board', async () => {
    const day = await asOwner((tx) => lodgingDay(tx));
    expect(day.plan.arrivals.map((s) => s.guestName)).toEqual(
      expect.arrayContaining(['משפחת כהן', 'קבוצת צוללים']),
    );
    const cohen = day.plan.arrivals.find((s) => s.guestName === 'משפחת כהן')!;
    await asOwner((tx) => moveStay(tx, { id: cohen.id, move: 'check_in' }));
    await expect(
      asOwner((tx) => moveStay(tx, { id: cohen.id, move: 'confirm' })),
    ).rejects.toMatchObject({
      code: 'lodging.errors.cannotMove',
    });
    await asOwner((tx) => moveStay(tx, { id: cohen.id, move: 'check_out' }));
    let rooms = await asOwner((tx) => loadRooms(tx));
    expect(rooms.find((r) => r.id === family[0])?.housekeeping).toBe('dirty');
    expect((await asOwner((tx) => lodgingDay(tx))).plan.toPrepare.map((p) => p.roomId)).toContain(
      family[0],
    );
    await asOwner((tx) => setHousekeeping(tx, { roomId: family[0]!, state: 'clean' }));
    rooms = await asOwner((tx) => loadRooms(tx));
    expect(rooms.find((r) => r.id === family[0])?.housekeeping).toBe('clean');

    const board = await asOwner((tx) => lodgingBoard(tx, today, 7));
    // Two family rooms and six dorm beds.
    expect(board.rows).toHaveLength(8);
    expect(board.rows.filter((r) => r.roomId === dorm && r.segments[0]?.stay)).toHaveLength(3);
  });

  it('sends the morning brief once, to the lodging number, only when on', async () => {
    expect(
      await withOrg(t.db, orgId, (tx) => sendMorningBrief(tx, { orgId, userId: null })),
    ).toEqual({
      sent: false,
      reason: 'off',
    });
    await asOwner((tx, ctx) =>
      saveLodgingSettings(tx, ctx, {
        enabled: true,
        checkInTime: '14:00',
        checkOutTime: '10:30',
        morningBrief: true,
        briefPhone: '052-0000202',
      }),
    );
    expect(
      await withOrg(t.db, orgId, (tx) => sendMorningBrief(tx, { orgId, userId: null })),
    ).toEqual({ sent: true });
    expect(
      await withOrg(t.db, orgId, (tx) => sendMorningBrief(tx, { orgId, userId: null })),
    ).toEqual({
      sent: false,
      reason: 'already',
    });
    const [msg] = await q(`select to_phone_e164, body from messages where organization_id = $1`, [
      orgId,
    ]);
    expect(msg.to_phone_e164).toBe('+972520000202');
    expect(msg.body).toContain('צ׳ק־אין');
    expect(msg.body).toContain('קבוצת צוללים');
  });

  it('answers the bot with free rooms and prices', async () => {
    const out = (await withOrg(t.db, orgId, async (tx) => ({
      on: await lodgingLeadBotModule.enabled(tx),
      facts: await lodgingLeadBotModule.facts(tx),
      free: await lodgingLeadBotModule.call(
        tx,
        { orgId, userId: null },
        '',
        'lodging_availability',
        {
          check_in: addDays(today, 10),
          check_out: addDays(today, 12),
          guests: 2,
        },
      ),
      bad: await lodgingLeadBotModule.call(
        tx,
        { orgId, userId: null },
        '',
        'lodging_availability',
        {
          check_in: addDays(today, 12),
          check_out: addDays(today, 10),
          guests: 2,
        },
      ),
    }))) as {
      on: boolean;
      facts: string[];
      free: { nights: number; options: { room: string; total_shekels: number }[] };
      bad: object;
    };
    expect(out.on).toBe(true);
    expect(out.facts[0]).toContain('Check-in from 14:00, check-out by 10:30');
    expect(out.free.nights).toBe(2);
    expect(out.free.options[0]).toMatchObject({ room: 'דורמס גדול', total_shekels: 320 });
    expect(out.bad).toEqual({ error: 'check_out must be after check_in' });
  });

  it('prices stays from the price list and keeps the price a stay was booked at', async () => {
    // 2027-07-05 is a Monday; the stay runs Monday to Saturday morning (Thursday and Friday are weekend nights).
    const [summer, weekend] = await asOwner(async (tx, ctx) => [
      await addRate(tx, ctx, {
        name: 'קיץ משפחות',
        kind: 'season',
        startsOn: '2027-07-01',
        endsOn: '2027-08-31',
        yearly: true,
        roomKind: 'family',
        mode: 'fixed',
        priceNight: 60_000,
        minNights: 3,
      }),
      await addRate(tx, ctx, {
        name: 'סוף שבוע',
        kind: 'weekend',
        nightsOfWeek: ['4', '5', '5'],
        roomKind: '',
        mode: 'percent',
        percent: 10,
        // The form sends every field; a weekend ignores the dates and the yearly box.
        startsOn: '2027-01-01',
        endsOn: '2027-01-02',
        yearly: 'on',
      }),
      await addRate(tx, ctx, {
        name: 'חגים',
        kind: 'holiday',
        mode: 'fixed',
        priceNight: 99_000,
        percent: 5,
      }),
    ]);
    const rates = await asOwner((tx) => loadRates(tx));
    expect(
      rates.map((r) => [
        r.kind,
        r.startsOn,
        r.yearly,
        r.nightsOfWeek,
        r.percent,
        r.priceNightAgorot,
      ]),
    ).toEqual([
      ['season', '2027-07-01', true, null, null, 60_000],
      ['weekend', null, false, [4, 5], 10, null],
      ['holiday', null, false, null, null, 99_000],
    ]);
    await expect(
      asOwner((tx, ctx) =>
        addRate(tx, ctx, { name: 'x', kind: 'season', mode: 'percent', percent: 5 }),
      ),
    ).rejects.toMatchObject({
      issues: [{ path: ['endsOn'], message: 'lodging.errors.rateDates' }],
    });
    await expect(
      asOwner((tx, ctx) =>
        addRate(tx, ctx, { name: 'x', kind: 'weekend', mode: 'percent', percent: 5 }),
      ),
    ).rejects.toMatchObject({ issues: [{ path: ['nightsOfWeek'] }] });
    await expect(
      asOwner((tx, ctx) => addRate(tx, ctx, { name: 'x', kind: 'holiday', mode: 'fixed' })),
    ).rejects.toMatchObject({ issues: [{ path: ['priceNight'] }] });
    await expect(
      asOwner((tx, ctx) => addRate(tx, ctx, { name: 'x', kind: 'holiday', mode: 'percent' })),
    ).rejects.toMatchObject({ issues: [{ path: ['percent'] }] });

    const ask = { checkIn: '2028-07-03', checkOut: '2028-07-08', guests: 2 };
    // 2028: the yearly season comes back. Mon-Wed 600, Thu-Fri 660 → 3,120 for the family rooms; the dorm keeps 90 a bed.
    const free = await asOwner((tx) => searchFree(tx, ask));
    const fam = free.find((o) => o.roomName === 'משפחתי 2');
    expect([fam?.totalAgorot, fam?.minNights, fam?.tooShort]).toEqual([312_000, 3, false]);
    expect(fam?.priced[3]?.rules.map((r) => r.name)).toEqual(['קיץ משפחות', 'סוף שבוע']);
    const short = await asOwner((tx) => searchFree(tx, { ...ask, checkOut: '2028-07-05' }));
    expect(short.find((o) => o.roomName === 'משפחתי 2')?.tooShort).toBe(true);

    // The office may book a short stay; the bot may not.
    await expect(
      asOwner((tx, ctx) =>
        bookStay(tx, ctx, {
          roomId: family[1]!,
          guestName: 'בוט',
          guests: 2,
          checkIn: '2028-07-03',
          checkOut: '2028-07-04',
          source: 'bot',
        }),
      ),
    ).rejects.toMatchObject({ code: 'lodging.errors.tooShort', params: { n: 3 } });
    const [id] = await asOwner((tx, ctx) =>
      bookStay(tx, ctx, { roomId: family[1]!, guestName: 'משפחת קיץ', ...ask }),
    );
    // A paused or removed rule changes the next quote, never a stay already booked.
    await asOwner(async (tx) => {
      await setRateActive(tx, { id: weekend!, active: '' });
      await removeRate(tx, { id: summer! });
    });
    const after = await asOwner((tx) =>
      searchFree(tx, { ...ask, checkIn: '2028-07-10', checkOut: '2028-07-15' }),
    );
    expect(after.find((o) => o.roomName === 'משפחתי 2')?.totalAgorot).toBe(225_000);
    expect((await asOwner((tx) => getStay(tx, id!)))?.totalAgorot).toBe(312_000);
    await expect(asOwner((tx) => removeRate(tx, { id: summer! }))).rejects.toMatchObject({
      code: 'common.errors.notFound',
    });
    await expect(
      asOwner((tx) => setRateActive(tx, { id: summer!, active: 'on' })),
    ).rejects.toMatchObject({ code: 'common.errors.notFound' });
  });

  it('knows the holiday nights, as Israel keeps them', () => {
    expect([...holidayNights('2027-06-08', '2027-06-14')]).toEqual([['2027-06-10', 'שבועות']]);
    expect([...holidayNights('2027-09-29', '2027-10-05')].map(([d, n]) => [d, n])).toEqual([
      ['2027-10-01', 'ראש השנה'],
      ['2027-10-02', 'ראש השנה ב׳'],
    ]);
    expect(holidayNights('2027-04-18', '2027-05-01').size).toBe(7);
    expect(holidaysAhead('2027-06-01', 30)).toEqual([{ date: '2027-06-10', name: 'שבועות' }]);
  });

  it('keeps lodging to the office', async () => {
    const seen = await asUser(t.db, { sub: instructorId, org_id: orgId }, (tx) => loadRooms(tx));
    expect(seen).toEqual([]);
  });
});
