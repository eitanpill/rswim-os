/**
 * Lodging (optional module), all fake: family rooms first, a couple of doubles and a shared dorm, with stays around
 * today so the morning plan has something to say: a family leaving and another arriving in the same room (a
 * turnover), guests in the house, a dorm group, and the next days booked.
 */
import { createDb, sql, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import {
  addDays,
  addRate,
  addRooms,
  bookingOf,
  bookStay,
  getStay,
  recordPayment,
  moveStay,
  saveLodgingSettings,
  setHousekeeping,
  type RoomInput,
} from '@rswim/domain-lodging';
import type pg from 'pg';

export interface LodgingDataSummary {
  rooms: number;
  stays: number;
}

type Kind = 'swim' | 'dive';

const ROOMS: Record<Kind, Omit<RoomInput, 'note'>[]> = {
  swim: [
    {
      name: 'משפחתי',
      kind: 'family',
      count: 4,
      beds: 3,
      maxGuests: 5,
      toilet: 'private',
      shower: 'private',
      priceNight: 65_000,
    },
    {
      name: 'זוגי',
      kind: 'double',
      count: 2,
      beds: 1,
      maxGuests: 2,
      toilet: 'private',
      shower: 'shared',
      priceNight: 42_000,
    },
    {
      name: 'דורמס',
      kind: 'dorm',
      count: 1,
      beds: 6,
      maxGuests: 6,
      toilet: 'shared',
      shower: 'shared',
      priceNight: 12_000,
    },
  ],
  dive: [
    {
      name: 'משפחתי',
      kind: 'family',
      count: 2,
      beds: 4,
      maxGuests: 5,
      toilet: 'private',
      shower: 'private',
      priceNight: 72_000,
    },
    {
      name: 'זוגי מול הים',
      kind: 'double',
      count: 2,
      beds: 1,
      maxGuests: 2,
      toilet: 'private',
      shower: 'private',
      priceNight: 55_000,
    },
    {
      name: 'דורמס צוללים',
      kind: 'dorm',
      count: 1,
      beds: 8,
      maxGuests: 8,
      toilet: 'shared',
      shower: 'shared',
      priceNight: 14_000,
    },
  ],
};

export async function seedLodgingData(
  client: pg.PoolClient,
  orgId: string,
  kind: Kind,
  fakePhone: () => string,
): Promise<LodgingDataSummary> {
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const [row] = (await tx.execute<{ d: string }>(sql`select app.today()::text as d`)).rows;
  const today = (row as { d: string }).d;
  const day = (n: number) => addDays(today, n);

  await saveLodgingSettings(tx, ctx, {
    enabled: true,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    morningBrief: true,
    briefPhone: null,
    minNights: 1,
    // A 30% deposit holds a booking for two days.
    depositPercent: 30,
    holdHours: 48,
  });

  // The price list: a dearer summer (every year), weekend nights, and the Hebrew holidays with a two-night minimum.
  if (kind === 'swim') {
    await addRate(tx, ctx, {
      name: 'קיץ',
      kind: 'season',
      startsOn: '2026-07-01',
      endsOn: '2026-08-31',
      yearly: true,
      mode: 'percent',
      percent: 20,
      minNights: 2,
    });
    await addRate(tx, ctx, {
      name: 'סוף שבוע',
      kind: 'weekend',
      nightsOfWeek: [4, 5],
      mode: 'percent',
      percent: 15,
    });
    await addRate(tx, ctx, {
      name: 'חגים',
      kind: 'holiday',
      roomKind: 'family',
      mode: 'fixed',
      priceNight: 85_000,
      minNights: 2,
    });
  } else {
    // Eilat is busiest in the winter and on the holidays.
    await addRate(tx, ctx, {
      name: 'חורף באילת',
      kind: 'season',
      startsOn: '2026-11-01',
      endsOn: '2027-02-28',
      yearly: true,
      mode: 'percent',
      percent: 15,
    });
    await addRate(tx, ctx, {
      name: 'סוף שבוע',
      kind: 'weekend',
      nightsOfWeek: [4, 5],
      mode: 'percent',
      percent: 10,
    });
    await addRate(tx, ctx, {
      name: 'חגים',
      kind: 'holiday',
      mode: 'percent',
      percent: 30,
      minNights: 2,
    });
  }

  const groups: string[][] = [];
  for (const r of ROOMS[kind]) groups.push(await addRooms(tx, ctx, { ...r, note: null }));
  const room = (group: number, i: number): string => {
    const id = groups[group]?.[i];
    if (!id) throw new Error(`lodging seed: no room ${group}/${i}`);
    return id;
  };

  let stays = 0;
  const book = async (
    roomId: string,
    guestName: string,
    guests: number,
    from: number,
    to: number,
    state: 'held' | 'confirmed' | 'in' = 'confirmed',
    note: string | null = null,
  ) => {
    const ids = await bookStay(tx, ctx, {
      roomId,
      bedId: null,
      guestName,
      phone: fakePhone(),
      guests,
      checkIn: day(from),
      checkOut: day(to),
      hold: state === 'held',
      note,
      source: 'office',
      leadId: null,
    });
    if (state === 'in') for (const id of ids) await moveStay(tx, { id, move: 'check_in' });
    stays += ids.length;
    return ids[0] as string;
  };
  /** What the guest paid so far: the deposit, or the whole stay. */
  const paid = async (stayId: string, part: 'deposit' | 'all', method: 'cash' | 'bit' | 'card') => {
    const stay = await getStay(tx, stayId);
    const view = await bookingOf(tx, stay?.bookingId ?? '');
    const amount = part === 'deposit' ? view.money.depositAgorot : view.money.totalAgorot;
    if (amount) await recordPayment(tx, ctx, { stayId, amount, method });
  };

  if (kind === 'swim') {
    // Family room 1 turns over today: the Mizrahis leave, the Ben Davids arrive.
    await paid(await book(room(0, 0), 'משפחת מזרחי', 4, -3, 0, 'in'), 'all', 'card');
    await paid(
      await book(
        room(0, 0),
        'משפחת בן דוד',
        5,
        0,
        4,
        'confirmed',
        'מגיעים עם עגלה, לבקש מיטת תינוק',
      ),
      'deposit',
      'bit',
    );
    await paid(await book(room(0, 1), 'משפחת אוחיון', 4, -1, 2, 'in'), 'deposit', 'cash');
    await book(room(0, 2), 'משפחת גולן', 3, 0, 3);
    await book(room(0, 3), 'משפחת שטרן', 5, 2, 6, 'held', 'מחכים לאישור תאריכים');
    await book(room(0, 1), 'משפחת ברק', 4, 3, 7);
    await book(room(1, 0), 'נועה ואלון', 2, -2, 0, 'in');
    await book(room(1, 1), 'יעל פרידמן', 1, 1, 3);
    await book(room(2, 0), 'קבוצת מאמני שחייה', 4, -1, 1, 'in');
    await book(room(2, 0), 'זוג תרמילאים', 2, 1, 3);
    // Room 4 was left untidy by the last guests.
    await setHousekeeping(tx, { roomId: room(0, 3), state: 'dirty' });
  } else {
    await book(room(0, 0), 'משפחת אדלר', 4, -2, 0, 'in');
    await paid(
      await book(room(0, 0), 'משפחת חדד', 4, 0, 3, 'confirmed', 'קורס צלילה חופשית לאבא'),
      'deposit',
      'bit',
    );
    await book(room(0, 1), 'משפחת רוזנברג', 5, 1, 4, 'held');
    await book(room(1, 0), 'דניאל ומאיה', 2, -1, 2, 'in');
    await book(room(1, 1), 'תום לוי', 1, 0, 2);
    await book(room(2, 0), 'סדנת סוף שבוע', 6, -1, 1, 'in');
    await book(room(2, 0), 'צוללים מחיפה', 3, 2, 5);
  }

  return { rooms: groups.flat().length, stays };
}
