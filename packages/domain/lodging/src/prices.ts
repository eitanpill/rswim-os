/**
 * Lodging's price list (docs/LODGING.md, "Prices"), as pure functions: what one night of a room costs once the
 * season, the weekend and the Hebrew holidays have had their say, the whole stay's price night by night, and the
 * fewest nights the stay must be. The services hand in the holiday nights (from @rswim/calendar); nothing here reads
 * a clock or a database.
 *
 * One night, in this order:
 *  1. the room's own price;
 *  2. a season on that night sets or moves it (a season for this kind of room beats one for every room, then the
 *     shorter season, then the later-added one);
 *  3. then a holiday night, or else a weekend night, sets or moves it again (the same tie-break).
 * A percent on an unpriced room leaves it unpriced; a fixed price prices it. The stay's minimum is the most nights any
 * rule touching one of its nights asks for, and never less than the business's own minimum.
 */
import type { RateKind, RateMode, RoomKind, RoomPricePer, RoomSoldBy } from '@rswim/contracts';
import { addDays, nightsBetween } from './dates';

export interface RateFacts {
  id: string;
  name: string;
  kind: RateKind;
  /** A season's first and last night, inclusive. */
  startsOn: string | null;
  endsOn: string | null;
  yearly: boolean;
  /** The weekend's nights: 0 = the night from Sunday to Monday … 6 = Saturday night. */
  nightsOfWeek: number[] | null;
  /** Null: every room. */
  roomKind: RoomKind | null;
  mode: RateMode;
  priceNightAgorot: number | null;
  percent: number | null;
  minNights: number | null;
  active: boolean;
  /** For the tie-break: later wins. */
  createdAt: string;
}

/** What a room needs for pricing. */
export interface PricedRoom {
  kind: RoomKind;
  soldBy: RoomSoldBy;
  pricePer: RoomPricePer;
  priceNightAgorot: number | null;
}

/** Holiday nights: the night's date → the holiday's name (the night before the holiday, and its middle days). */
export type HolidayNights = ReadonlyMap<string, string>;

export interface NightPrice {
  date: string;
  /** For the whole booking (all its guests when priced per guest or per bed); null when unpriced. */
  agorot: number | null;
  /** The rules that shaped this night, in the order they applied (their names, a holiday's name after its rule's). */
  rules: { id: string; name: string; kind: RateKind; holiday?: string }[];
}

export interface StayQuote {
  nights: NightPrice[];
  /** Null when any night is unpriced. */
  totalAgorot: number | null;
  /** The fewest nights a stay over these dates must be. */
  minNights: number;
  /** The stay is shorter than that. */
  tooShort: boolean;
}

/** Month and day of an ISO date, for a yearly season. */
const md = (date: string) => date.slice(5);

/** Whether a season covers this night. A yearly season may wrap the new year (Dec 20 → Jan 5). */
export function seasonCovers(
  rate: Pick<RateFacts, 'startsOn' | 'endsOn' | 'yearly'>,
  night: string,
): boolean {
  if (!rate.startsOn || !rate.endsOn) return false;
  if (!rate.yearly) return rate.startsOn <= night && night <= rate.endsOn;
  const [from, to, at] = [md(rate.startsOn), md(rate.endsOn), md(night)];
  return from <= to ? from <= at && at <= to : at >= from || at <= to;
}

/** The night's weekday, 0 (Sunday) to 6 (Saturday), in UTC so no time zone moves it. */
export function nightOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const fitsRoom = (rate: RateFacts, room: PricedRoom) =>
  rate.active && (rate.roomKind === null || rate.roomKind === room.kind);

/** How long a season is, for the tie-break (a holiday or weekend rule counts as one night). */
const span = (rate: RateFacts) =>
  rate.startsOn && rate.endsOn ? nightsBetween(rate.startsOn, rate.endsOn) : 0;

/** The one rule that wins among several for the same night. */
function winner(rates: RateFacts[]): RateFacts | undefined {
  return [...rates].sort(
    (a, b) =>
      Number(b.roomKind !== null) - Number(a.roomKind !== null) ||
      span(a) - span(b) ||
      b.createdAt.localeCompare(a.createdAt),
  )[0];
}

/** A rule's effect on a price: a fixed price replaces it, a percent moves it (rounded to a whole shekel). */
export function applyRate(
  price: number | null,
  rate: Pick<RateFacts, 'mode' | 'priceNightAgorot' | 'percent'>,
): number | null {
  if (rate.mode === 'fixed') return rate.priceNightAgorot;
  if (price === null) return null;
  return Math.max(0, Math.round((price * (100 + (rate.percent ?? 0))) / 10_000) * 100);
}

/** The rules that apply to one night of a room: its season, then its holiday or weekend. */
export function rulesForNight(
  room: PricedRoom,
  date: string,
  rates: readonly RateFacts[],
  holidays: HolidayNights,
): { rate: RateFacts; holiday?: string }[] {
  const mine = rates.filter((r) => fitsRoom(r, room));
  const out: { rate: RateFacts; holiday?: string }[] = [];
  const season = winner(mine.filter((r) => r.kind === 'season' && seasonCovers(r, date)));
  if (season) out.push({ rate: season });
  const holiday = holidays.get(date);
  const holidayRule = holiday ? winner(mine.filter((r) => r.kind === 'holiday')) : undefined;
  if (holidayRule) {
    out.push({ rate: holidayRule, holiday });
  } else {
    const weekday = nightOfWeek(date);
    const weekend = winner(
      mine.filter((r) => r.kind === 'weekend' && (r.nightsOfWeek ?? []).includes(weekday)),
    );
    if (weekend) out.push({ rate: weekend });
  }
  return out;
}

/** How many units the night's price is for: one whole room, or each guest (per guest, or a dorm's beds). */
export function unitsFor(room: Pick<PricedRoom, 'soldBy' | 'pricePer'>, guests: number): number {
  return room.soldBy === 'bed' || room.pricePer === 'guest' ? guests : 1;
}

/**
 * The stay's price night by night, its total, and the fewest nights it must be. `guests` is the booking's guests (for
 * a dorm: how many beds).
 */
export function quoteStay(
  room: PricedRoom,
  ask: { checkIn: string; checkOut: string; guests: number },
  rates: readonly RateFacts[],
  holidays: HolidayNights,
  businessMinNights = 1,
): StayQuote {
  const count = Math.max(0, nightsBetween(ask.checkIn, ask.checkOut));
  const units = unitsFor(room, ask.guests);
  let minNights = Math.max(1, businessMinNights);
  const nights: NightPrice[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(ask.checkIn, i);
    const rules = rulesForNight(room, date, rates, holidays);
    let price = room.priceNightAgorot;
    for (const { rate } of rules) {
      price = applyRate(price, rate);
      if (rate.minNights) minNights = Math.max(minNights, rate.minNights);
    }
    nights.push({
      date,
      agorot: price === null ? null : price * units,
      rules: rules.map(({ rate, holiday }) => ({
        id: rate.id,
        name: rate.name,
        kind: rate.kind,
        ...(holiday ? { holiday } : {}),
      })),
    });
  }
  const totalAgorot = nights.reduce<number | null>(
    (sum, n) => (sum === null || n.agorot === null ? null : sum + n.agorot),
    0,
  );
  return { nights, totalAgorot, minNights, tooShort: count < minNights };
}

export type RateProblem =
  'lodging.errors.rateDates' | 'lodging.errors.rateNights' | 'lodging.errors.rateValue';

/** Why a rule cannot be saved as asked, or null. */
export function rateProblem(rate: {
  kind: RateKind;
  startsOn: string | null;
  endsOn: string | null;
  nightsOfWeek: number[] | null;
  mode: RateMode;
  priceNightAgorot: number | null;
  percent: number | null;
}): RateProblem | null {
  if (rate.kind === 'season' && (!rate.startsOn || !rate.endsOn || rate.endsOn < rate.startsOn)) {
    return 'lodging.errors.rateDates';
  }
  if (rate.kind === 'weekend' && !rate.nightsOfWeek?.length) return 'lodging.errors.rateNights';
  if (
    rate.mode === 'fixed'
      ? rate.priceNightAgorot === null
      : rate.percent === null || rate.percent === 0
  ) {
    return 'lodging.errors.rateValue';
  }
  return null;
}
