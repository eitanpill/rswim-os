/**
 * Lodging's rules (docs/LODGING.md), as pure functions: how a room is sold, which rooms and beds are free for some
 * nights, the occupancy board, and the morning plan (who arrives, who leaves, which rooms to prepare) with its
 * WhatsApp text. The database repeats the one rule that must never break (no room or bed sold twice, migration 0070).
 */
import {
  STAY_HOLDING,
  type HousekeepingState,
  type RoomFacility,
  type RoomKind,
  type RoomPricePer,
  type RoomSoldBy,
  type StayStatus,
} from '@rswim/contracts';
import { agorot, formatILS } from '@rswim/money';
import { addDays, nightsBetween } from './dates';
import { quoteStay, type HolidayNights, type NightPrice, type RateFacts } from './prices';

export interface RoomFacts {
  id: string;
  name: string;
  kind: RoomKind;
  soldBy: RoomSoldBy;
  pricePer: RoomPricePer;
  maxGuests: number;
  priceNightAgorot: number | null;
  toilet: RoomFacility;
  shower: RoomFacility;
  housekeeping: HousekeepingState;
  active: boolean;
  /** The room's active beds, in order. */
  beds: { id: string; label: string }[];
}

export interface StayFacts {
  id: string;
  roomId: string;
  bedId: string | null;
  guestName: string;
  guests: number;
  checkIn: string;
  checkOut: string;
  status: StayStatus;
}

/** A shared dorm is sold bed by bed; every other room is booked whole. */
export function soldByFor(kind: RoomKind): RoomSoldBy {
  return kind === 'dorm' ? 'bed' : 'room';
}

/** The names of `count` rooms added at once: "חדר" ×3 → "חדר 1", "חדר 2", "חדר 3" (one room keeps its name). */
export function roomNames(name: string, count: number, from = 1): string[] {
  if (count <= 1) return [name];
  return Array.from({ length: count }, (_, i) => `${name} ${from + i}`);
}

export { addDays, nightsBetween } from './dates';

const holds = (s: StayFacts) => STAY_HOLDING.includes(s.status);
const overlaps = (
  a: { checkIn: string; checkOut: string },
  b: { checkIn: string; checkOut: string },
) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;

/** Whether a stay of these nights fits in the room (whole: bedId null) or the bed, beside the other stays. */
export function isFree(
  room: RoomFacts,
  bedId: string | null,
  nights: { checkIn: string; checkOut: string },
  stays: readonly StayFacts[],
  exceptStayId?: string,
): boolean {
  return !stays.some(
    (s) =>
      s.roomId === room.id &&
      s.id !== exceptStayId &&
      holds(s) &&
      overlaps(s, nights) &&
      (bedId === null || s.bedId === null || s.bedId === bedId),
  );
}

export type StayProblem =
  | 'lodging.errors.dates'
  | 'lodging.errors.tooLong'
  | 'lodging.errors.roomClosed'
  | 'lodging.errors.tooManyGuests'
  | 'lodging.errors.notEnoughBeds'
  | 'lodging.errors.taken';

/** The longest stay one booking may hold. */
export const MAX_NIGHTS = 60;

/**
 * Why a stay cannot be booked as asked, or null. A dorm without a named bed takes as many free beds as guests; a named
 * bed takes one guest (the services split a group into one stay per bed).
 */
export function stayProblem(
  room: RoomFacts,
  ask: { bedId: string | null; guests: number; checkIn: string; checkOut: string },
  stays: readonly StayFacts[],
  exceptStayId?: string,
): StayProblem | null {
  if (ask.checkOut <= ask.checkIn) return 'lodging.errors.dates';
  if (nightsBetween(ask.checkIn, ask.checkOut) > MAX_NIGHTS) return 'lodging.errors.tooLong';
  if (!room.active) return 'lodging.errors.roomClosed';
  if (room.soldBy === 'bed' && ask.bedId === null) {
    return freeBeds(room, ask, stays, exceptStayId).length < ask.guests
      ? 'lodging.errors.notEnoughBeds'
      : null;
  }
  if (ask.bedId === null && ask.guests > room.maxGuests) return 'lodging.errors.tooManyGuests';
  return isFree(room, ask.bedId, ask, stays, exceptStayId) ? null : 'lodging.errors.taken';
}

/** The room's beds free for all these nights, in order. */
export function freeBeds(
  room: RoomFacts,
  nights: { checkIn: string; checkOut: string },
  stays: readonly StayFacts[],
  exceptStayId?: string,
): { id: string; label: string }[] {
  return room.beds.filter((b) => isFree(room, b.id, nights, stays, exceptStayId));
}

export interface FreeOption {
  roomId: string;
  roomName: string;
  kind: RoomKind;
  soldBy: RoomSoldBy;
  /** Free beds of a dorm (all of them a guest could take); empty for a whole room. */
  bedIds: string[];
  /** How many guests this option holds: the room's maximum, or the dorm's free beds. */
  room: number;
  nights: number;
  /** The whole stay for these guests from the price list, when the room has a price. */
  totalAgorot: number | null;
  /** Night by night, with the rules that shaped each night. */
  priced: NightPrice[];
  /** The fewest nights these dates ask for, and whether the stay is shorter. */
  minNights: number;
  tooShort: boolean;
}

/** The price list a search prices with: its rules, the holiday nights in range, and the business's minimum stay. */
export interface Pricing {
  rates: readonly RateFacts[];
  holidays: HolidayNights;
  minNights: number;
}

const NO_PRICING: Pricing = { rates: [], holidays: new Map(), minNights: 1 };

/**
 * Rooms and dorm beds free for these nights that hold this many guests, cheapest first (unpriced last), then by name.
 */
export function freeOptions(
  rooms: readonly RoomFacts[],
  stays: readonly StayFacts[],
  ask: { checkIn: string; checkOut: string; guests: number },
  pricing: Pricing = NO_PRICING,
): FreeOption[] {
  if (ask.checkOut <= ask.checkIn) return [];
  const nights = nightsBetween(ask.checkIn, ask.checkOut);
  const out: FreeOption[] = [];
  for (const room of rooms) {
    if (!room.active) continue;
    const quoted = () => {
      const q = quoteStay(room, ask, pricing.rates, pricing.holidays, pricing.minNights);
      return {
        totalAgorot: q.totalAgorot,
        priced: q.nights,
        minNights: q.minNights,
        tooShort: q.tooShort,
      };
    };
    if (room.soldBy === 'bed') {
      const beds = freeBeds(room, ask, stays);
      if (beds.length >= ask.guests) {
        out.push({
          roomId: room.id,
          roomName: room.name,
          kind: room.kind,
          soldBy: 'bed',
          bedIds: beds.map((b) => b.id),
          room: beds.length,
          nights,
          ...quoted(),
        });
      }
    } else if (room.maxGuests >= ask.guests && isFree(room, null, ask, stays)) {
      out.push({
        roomId: room.id,
        roomName: room.name,
        kind: room.kind,
        soldBy: 'room',
        bedIds: [],
        room: room.maxGuests,
        nights,
        ...quoted(),
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(a.tooShort) - Number(b.tooShort) ||
      (a.totalAgorot ?? Number.MAX_SAFE_INTEGER) - (b.totalAgorot ?? Number.MAX_SAFE_INTEGER) ||
      a.roomName.localeCompare(b.roomName, 'he'),
  );
}

// ─── The board ──────────────────────────────────────────────────────────────

export interface BoardSegment {
  /** Index of the first night shown in this segment. */
  start: number;
  length: number;
  stay: StayFacts | null;
  /** The stay began before the first night shown, or goes on after the last. */
  before: boolean;
  after: boolean;
}

export interface BoardRow {
  roomId: string;
  roomName: string;
  bedId: string | null;
  bedLabel: string | null;
  housekeeping: HousekeepingState;
  segments: BoardSegment[];
}

/**
 * The occupancy board: a row per whole room, or per bed of a dorm, across `nights` nights from `from`; each row is a
 * run of free nights and stays. A whole-room stay of a dorm fills each of its beds' rows.
 */
export function boardRows(
  rooms: readonly RoomFacts[],
  stays: readonly StayFacts[],
  from: string,
  nights: number,
): BoardRow[] {
  const to = addDays(from, nights);
  const shown = stays.filter((s) => holds(s) && overlaps(s, { checkIn: from, checkOut: to }));
  const rows: BoardRow[] = [];
  for (const room of rooms.filter((r) => r.active)) {
    const lines =
      room.soldBy === 'bed'
        ? room.beds.map((b) => ({ bedId: b.id, bedLabel: b.label }))
        : [{ bedId: null, bedLabel: null }];
    for (const line of lines) {
      const mine = shown.filter(
        (s) => s.roomId === room.id && (s.bedId === null || s.bedId === line.bedId),
      );
      rows.push({
        roomId: room.id,
        roomName: room.name,
        bedId: line.bedId,
        bedLabel: line.bedLabel,
        housekeeping: room.housekeeping,
        segments: segmentsOf(mine, from, nights),
      });
    }
  }
  return rows;
}

function segmentsOf(stays: StayFacts[], from: string, nights: number): BoardSegment[] {
  const out: BoardSegment[] = [];
  let i = 0;
  while (i < nights) {
    const night = addDays(from, i);
    const stay = stays.find((s) => s.checkIn <= night && night < s.checkOut);
    if (!stay) {
      const last = out[out.length - 1];
      if (last && last.stay === null) last.length++;
      else out.push({ start: i, length: 1, stay: null, before: false, after: false });
      i++;
      continue;
    }
    const end = Math.min(nights, nightsBetween(from, stay.checkOut));
    out.push({
      start: i,
      length: end - i,
      stay,
      before: stay.checkIn < from,
      after: end === nights && stay.checkOut > addDays(from, nights),
    });
    i = end;
  }
  return out;
}

// ─── The day ────────────────────────────────────────────────────────────────

export interface DayPlan {
  date: string;
  /** Stays that start today and have not arrived yet. */
  arrivals: StayFacts[];
  /** Stays that end today and have not left yet. */
  departures: StayFacts[];
  /** Guests sleeping here tonight (arriving today included). */
  inHouse: StayFacts[];
  /** Rooms to prepare today, the urgent ones (someone arrives) first. */
  toPrepare: {
    roomId: string;
    roomName: string;
    why: 'turnover' | 'departure' | 'dirty';
    arrivalToday: boolean;
  }[];
  /** Occupied units tonight (rooms, and dorm beds) out of all units. */
  occupiedTonight: number;
  unitsTonight: number;
}

/**
 * The day as reception and housekeeping need it: who arrives and leaves, who sleeps here, and which rooms to make up
 * (a room someone leaves and someone else enters today first, then rooms left today, then rooms still dirty).
 */
export function dayPlan(
  rooms: readonly RoomFacts[],
  stays: readonly StayFacts[],
  date: string,
): DayPlan {
  const live = stays.filter(holds);
  const arrivals = live.filter(
    (s) => s.checkIn === date && (s.status === 'held' || s.status === 'confirmed'),
  );
  const departures = live.filter(
    (s) => s.checkOut === date && (s.status === 'confirmed' || s.status === 'checked_in'),
  );
  const tonight = { checkIn: date, checkOut: addDays(date, 1) };
  const inHouse = live.filter((s) => s.status !== 'checked_out' && overlaps(s, tonight));
  const byRoom = new Map(rooms.map((r) => [r.id, r]));
  const leaving = new Set(
    live.filter((s) => s.checkOut === date && s.status !== 'held').map((s) => s.roomId),
  );
  const arriving = new Set(arrivals.map((s) => s.roomId));
  const toPrepare: DayPlan['toPrepare'] = [];
  for (const room of rooms) {
    if (!room.active || room.housekeeping === 'out_of_order') continue;
    const left = leaving.has(room.id);
    if (!left && room.housekeeping !== 'dirty') continue;
    const arrivalToday = arriving.has(room.id);
    toPrepare.push({
      roomId: room.id,
      roomName: room.name,
      why: left ? (arrivalToday ? 'turnover' : 'departure') : 'dirty',
      arrivalToday,
    });
  }
  const rank = { turnover: 0, departure: 1, dirty: 2 } as const;
  toPrepare.sort(
    (a, b) =>
      Number(b.arrivalToday) - Number(a.arrivalToday) ||
      rank[a.why] - rank[b.why] ||
      a.roomName.localeCompare(b.roomName, 'he'),
  );
  let units = 0;
  let occupied = 0;
  for (const room of rooms) {
    if (!room.active) continue;
    const mine = inHouse.filter((s) => s.roomId === room.id);
    if (room.soldBy === 'bed') {
      units += room.beds.length;
      occupied += mine.some((s) => s.bedId === null)
        ? room.beds.length
        : new Set(mine.map((s) => s.bedId)).size;
    } else {
      units++;
      if (mine.length) occupied++;
    }
  }
  const sortStays = (list: StayFacts[]) =>
    list.sort((a, b) =>
      (byRoom.get(a.roomId)?.name ?? '').localeCompare(byRoom.get(b.roomId)?.name ?? '', 'he'),
    );
  return {
    date,
    arrivals: sortStays(arrivals),
    departures: sortStays(departures),
    inHouse,
    toPrepare,
    occupiedTonight: occupied,
    unitsTonight: units,
  };
}

const BRIEF = {
  he: {
    title: (d: string) => `🛏️ לינה היום (${d})`,
    arrivals: (n: number, at: string) => `צ׳ק־אין (${n}) מ־${at}:`,
    departures: (n: number, at: string) => `צ׳ק־אאוט (${n}) עד ${at}:`,
    prepare: (n: number) => `חדרים לסדר (${n}):`,
    why: {
      turnover: 'מתחלפים היום, להכין לפני ההגעה',
      departure: 'עוזבים היום',
      dirty: 'עדיין לא סודר',
    },
    none: 'אין',
    guests: (n: number) => (n === 1 ? 'אורח אחד' : `${n} אורחים`),
    bed: 'מיטה',
    tonight: (o: number, u: number) => `הלילה תפוסים ${o} מתוך ${u}.`,
    quiet: 'אין הגעות ואין עזיבות היום.',
  },
  en: {
    title: (d: string) => `🛏️ Lodging today (${d})`,
    arrivals: (n: number, at: string) => `Check-in (${n}) from ${at}:`,
    departures: (n: number, at: string) => `Check-out (${n}) by ${at}:`,
    prepare: (n: number) => `Rooms to prepare (${n}):`,
    why: {
      turnover: 'changeover today, ready before arrival',
      departure: 'leaving today',
      dirty: 'not made up yet',
    },
    none: 'none',
    guests: (n: number) => (n === 1 ? '1 guest' : `${n} guests`),
    bed: 'bed',
    tonight: (o: number, u: number) => `Tonight ${o} of ${u} are taken.`,
    quiet: 'No arrivals and no departures today.',
  },
} as const;

/** The morning WhatsApp: arrivals, departures and rooms to prepare, in the reader's language. */
export function briefText(
  plan: DayPlan,
  rooms: readonly RoomFacts[],
  times: { checkIn: string; checkOut: string },
  locale: 'he' | 'en',
): string {
  const w = BRIEF[locale];
  const byRoom = new Map(rooms.map((r) => [r.id, r]));
  const where = (s: StayFacts) => {
    const room = byRoom.get(s.roomId);
    if (!room) return '';
    const bed = s.bedId ? room.beds.find((b) => b.id === s.bedId) : undefined;
    return bed ? `${room.name}, ${w.bed} ${bed.label}` : room.name;
  };
  const line = (s: StayFacts) => `• ${s.guestName}, ${w.guests(s.guests)} — ${where(s)}`;
  const [y, m, d] = plan.date.split('-');
  const out: string[] = [w.title(`${d}.${m}.${y}`)];
  if (!plan.arrivals.length && !plan.departures.length) out.push(w.quiet);
  if (plan.departures.length) {
    out.push(
      '',
      w.departures(plan.departures.length, times.checkOut),
      ...plan.departures.map(line),
    );
  }
  if (plan.arrivals.length) {
    out.push('', w.arrivals(plan.arrivals.length, times.checkIn), ...plan.arrivals.map(line));
  }
  out.push('', w.prepare(plan.toPrepare.length));
  out.push(
    ...(plan.toPrepare.length
      ? plan.toPrepare.map((p) => `• ${p.roomName} — ${w.why[p.why]}`)
      : [w.none]),
  );
  out.push('', w.tonight(plan.occupiedTonight, plan.unitsTonight));
  return out.join('\n');
}

/** Plain lines about the rooms for the new-customers bot (what kinds, how many, what they cost, the price list). */
export function botFacts(
  rooms: readonly RoomFacts[],
  times: { checkIn: string; checkOut: string },
  rates: readonly RateFacts[] = [],
  minNights = 1,
): string[] {
  const active = rooms.filter((r) => r.active);
  if (!active.length) return [];
  const lines = [
    `Lodging on site: ${active.length} rooms. Check-in from ${times.checkIn}, check-out by ${times.checkOut}.`,
  ];
  if (minNights > 1) lines.push(`Minimum stay: ${minNights} nights.`);
  for (const r of active) {
    const per = r.soldBy === 'bed' ? ' per bed' : r.pricePer === 'guest' ? ' per guest' : '';
    const price =
      r.priceNightAgorot === null
        ? 'price on request'
        : `${formatILS(agorot(r.priceNightAgorot), 'he')} a night${per} (base price)`;
    const sleeps =
      r.soldBy === 'bed' ? `${r.beds.length} beds sold one by one` : `up to ${r.maxGuests} guests`;
    lines.push(
      `- ${r.name} (${r.kind}): ${sleeps}; toilet ${r.toilet}, shower ${r.shower}; ${price}.`,
    );
  }
  const live = rates.filter((r) => r.active);
  if (live.length) {
    lines.push('Price list on top of the base prices:');
    for (const r of live) {
      const effect =
        r.mode === 'fixed'
          ? `${formatILS(agorot(r.priceNightAgorot ?? 0), 'he')} a night`
          : `${(r.percent ?? 0) > 0 ? '+' : ''}${r.percent ?? 0}%`;
      const when =
        r.kind === 'season'
          ? `${r.startsOn} to ${r.endsOn}${r.yearly ? ' every year' : ''}`
          : r.kind === 'weekend'
            ? `weekend nights (${(r.nightsOfWeek ?? []).join(', ')}; 0 = Sunday night)`
            : 'Jewish holiday nights';
      const min = r.minNights ? `, at least ${r.minNights} nights` : '';
      lines.push(
        `- ${r.name}: ${when}${r.roomKind ? ` (${r.roomKind} rooms)` : ''}: ${effect}${min}.`,
      );
    }
  }
  lines.push(
    'Never compute a price yourself: lodging_availability gives the exact total for the dates; the office confirms the booking.',
  );
  return lines;
}
