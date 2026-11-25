/**
 * Lodging (docs/LODGING.md): the business sets up its rooms (kind, beds, guests, toilet and shower, price), the office
 * books stays on the board, checks guests in and out, and marks rooms made up. Every morning reception (or the owner)
 * hears today's arrivals, departures and rooms to prepare on WhatsApp. One module for swim schools and freediving
 * clubs; the office of each (owner and admins) runs it.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dayInfo } from '@rswim/calendar';
import {
  checkbox,
  HOUSEKEEPING_STATES,
  optionalDate,
  optionalInt,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
  RATE_KINDS,
  RATE_MODES,
  ROOM_FACILITIES,
  ROOM_KINDS,
  ROOM_PRICE_PER,
  STAY_HOLDING,
  STAY_BOOKING_SOURCES,
  type HousekeepingState,
  type LodgingPaymentKind,
  type RoomFacility,
  type RateKind,
  type RateMode,
  type RoomKind,
  type RoomPricePer,
  type RoomSoldBy,
  type StayStatus,
} from '@rswim/contracts';
import { and, asc, desc, eq, gt, inArray, lt, schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import { getAgentSettings } from '@rswim/domain-copilot';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import {
  addDays,
  boardRows,
  briefText,
  dayPlan,
  freeBeds,
  freeOptions,
  isFree,
  nightsBetween,
  roomNames,
  soldByFor,
  stayProblem,
  type BoardRow,
  type DayPlan,
  type FreeOption,
  type Pricing,
  type RoomFacts,
  type StayFacts,
} from './policies';
import { bookingMoney, holdUntil } from './deposit';
import { quoteStay, rateProblem, type RateFacts, type StayQuote } from './prices';

const { lodgingSettings, lodgingRooms, lodgingBeds, lodgingStays, lodgingRates, lodgingPayments } =
  schema;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'forms.errors.invalid');

export const LodgingSettingsInput = z.object({
  enabled: checkbox(),
  checkInTime: hhmm,
  checkOutTime: hhmm,
  morningBrief: checkbox(),
  briefPhone: optionalPhone(),
  minNights: requiredInt(1, 30).default(1),
  depositPercent: requiredInt(0, 100).default(0),
  holdHours: requiredInt(1, 168).default(24),
  guestReminder: checkbox(),
  arrivalNote: optionalText(1000),
  payAtArrival: checkbox(),
});
export type LodgingSettingsInput = z.input<typeof LodgingSettingsInput>;

export interface LodgingSettingsView {
  enabled: boolean;
  checkInTime: string;
  checkOutTime: string;
  morningBrief: boolean;
  briefPhoneE164: string | null;
  minNights: number;
  depositPercent: number;
  holdHours: number;
  guestReminder: boolean;
  arrivalNote: string | null;
  /** Guests may pay what is left after the deposit at the desk on arrival (cash or card). */
  payAtArrival: boolean;
}

export async function getLodgingSettings(tx: Tx): Promise<LodgingSettingsView> {
  const [row] = await tx.select().from(lodgingSettings).limit(1);
  return {
    enabled: row?.enabled ?? false,
    checkInTime: row?.checkInTime ?? '15:00',
    checkOutTime: row?.checkOutTime ?? '11:00',
    morningBrief: row?.morningBrief ?? true,
    briefPhoneE164: row?.briefPhoneE164 ?? null,
    minNights: row?.minNights ?? 1,
    depositPercent: row?.depositPercent ?? 0,
    holdHours: row?.holdHours ?? 24,
    guestReminder: row?.guestReminder ?? true,
    arrivalNote: row?.arrivalNote ?? null,
    payAtArrival: row?.payAtArrival ?? true,
  };
}

export async function saveLodgingSettings(
  tx: Tx,
  ctx: ServiceContext,
  input: LodgingSettingsInput,
): Promise<void> {
  const v = LodgingSettingsInput.parse(input);
  const values = {
    enabled: v.enabled,
    checkInTime: v.checkInTime,
    checkOutTime: v.checkOutTime,
    morningBrief: v.morningBrief,
    briefPhoneE164: v.briefPhone,
    minNights: v.minNights,
    depositPercent: v.depositPercent,
    holdHours: v.holdHours,
    guestReminder: v.guestReminder,
    arrivalNote: v.arrivalNote,
    payAtArrival: v.payAtArrival,
  };
  await guarded(() =>
    tx
      .insert(lodgingSettings)
      .values({ organizationId: ctx.orgId, ...values })
      .onConflictDoUpdate({ target: lodgingSettings.organizationId, set: values }),
  );
}

// ─── Rooms ──────────────────────────────────────────────────────────────────

const roomFields = {
  name: requiredText(60),
  kind: z.enum(ROOM_KINDS, 'forms.errors.invalid'),
  beds: requiredInt(1, 40),
  maxGuests: requiredInt(1, 60),
  toilet: z.enum(ROOM_FACILITIES, 'forms.errors.invalid'),
  shower: z.enum(ROOM_FACILITIES, 'forms.errors.invalid'),
  /** Agorot (the form's shekels go through shekelFields). */
  priceNight: optionalInt(0, 10_000_000),
  pricePer: z.enum(ROOM_PRICE_PER, 'forms.errors.invalid').default('room'),
  note: optionalText(500),
};

/**
 * One room, or several of the same kind at once ("חדר משפחה" ×4 → "חדר משפחה 1"…"4"). A dorm sleeps one guest a bed,
 * so its guests are its beds whatever the form says.
 */
export const RoomInput = z.object({ ...roomFields, count: requiredInt(1, 50).default(1) });
export type RoomInput = z.input<typeof RoomInput>;

export const RoomUpdate = z.object({ id: z.uuid(), ...roomFields, active: checkbox() });
export type RoomUpdate = z.input<typeof RoomUpdate>;

export async function addRooms(tx: Tx, ctx: ServiceContext, input: RoomInput): Promise<string[]> {
  const v = RoomInput.parse(input);
  const [last] = await tx
    .select({ sort: sql<number>`coalesce(max(${lodgingRooms.sort}), 0)` })
    .from(lodgingRooms);
  let sort = Number(last?.sort ?? 0);
  const ids: string[] = [];
  for (const name of roomNames(v.name, v.count)) {
    const [room] = await guarded(() =>
      tx
        .insert(lodgingRooms)
        .values({
          organizationId: ctx.orgId,
          name,
          kind: v.kind,
          soldBy: soldByFor(v.kind),
          beds: v.beds,
          maxGuests: v.kind === 'dorm' ? v.beds : v.maxGuests,
          toilet: v.toilet,
          shower: v.shower,
          priceNightAgorot: v.priceNight,
          pricePer: v.kind === 'dorm' ? 'room' : v.pricePer,
          note: v.note,
          sort: ++sort,
        })
        .returning({ id: lodgingRooms.id }),
    );
    const id = (room as { id: string }).id;
    await tx.insert(lodgingBeds).values(
      Array.from({ length: v.beds }, (_, i) => ({
        organizationId: ctx.orgId,
        roomId: id,
        label: String(i + 1),
        position: i + 1,
      })),
    );
    ids.push(id);
  }
  return ids;
}

/** Changes a room. Fewer beds closes the last ones, refused while a stay ahead holds one of them. */
export async function updateRoom(tx: Tx, ctx: ServiceContext, input: RoomUpdate): Promise<void> {
  const v = RoomUpdate.parse(input);
  const today = await todayIL(tx);
  const beds = await tx
    .select()
    .from(lodgingBeds)
    .where(eq(lodgingBeds.roomId, v.id))
    .orderBy(asc(lodgingBeds.position));
  const closing = beds.filter((b) => b.position > v.beds && b.active).map((b) => b.id);
  if (closing.length) {
    const [held] = await tx
      .select({ id: lodgingStays.id })
      .from(lodgingStays)
      .where(
        and(
          inArray(lodgingStays.bedId, closing),
          inArray(lodgingStays.status, ['held', 'confirmed', 'checked_in']),
          gt(lodgingStays.checkOut, today),
        ),
      )
      .limit(1);
    if (held) throw new DomainError('lodging.errors.bedInUse');
  }
  const updated = await guarded(() =>
    tx
      .update(lodgingRooms)
      .set({
        name: v.name,
        kind: v.kind,
        soldBy: soldByFor(v.kind),
        beds: v.beds,
        maxGuests: v.kind === 'dorm' ? v.beds : v.maxGuests,
        toilet: v.toilet,
        shower: v.shower,
        priceNightAgorot: v.priceNight,
        pricePer: v.kind === 'dorm' ? 'room' : v.pricePer,
        note: v.note,
        active: v.active,
      })
      .where(eq(lodgingRooms.id, v.id))
      .returning({ id: lodgingRooms.id }),
  );
  if (!updated.length) throw new DomainError('common.errors.notFound');
  for (const b of beds) {
    const active = b.position <= v.beds;
    if (b.active !== active) {
      await tx.update(lodgingBeds).set({ active }).where(eq(lodgingBeds.id, b.id));
    }
  }
  const have = beds.length;
  if (v.beds > have) {
    await tx.insert(lodgingBeds).values(
      Array.from({ length: v.beds - have }, (_, i) => ({
        organizationId: ctx.orgId,
        roomId: v.id,
        label: String(have + i + 1),
        position: have + i + 1,
      })),
    );
  }
}

export const HousekeepingInput = z.object({
  roomId: z.uuid(),
  state: z.enum(HOUSEKEEPING_STATES, 'forms.errors.invalid'),
});
export type HousekeepingInput = z.infer<typeof HousekeepingInput>;

export async function setHousekeeping(tx: Tx, input: HousekeepingInput): Promise<void> {
  const v = HousekeepingInput.parse(input);
  const done = await tx
    .update(lodgingRooms)
    .set({ housekeeping: v.state })
    .where(eq(lodgingRooms.id, v.roomId))
    .returning({ id: lodgingRooms.id });
  if (!done.length) throw new DomainError('common.errors.notFound');
}

export interface RoomRow extends RoomFacts {
  beds: { id: string; label: string }[];
  bedCount: number;
  note: string | null;
}

/** Every room with its active beds, in the business's order (closed rooms too, flagged). */
export async function loadRooms(tx: Tx): Promise<RoomRow[]> {
  const rooms = await tx
    .select()
    .from(lodgingRooms)
    .orderBy(asc(lodgingRooms.sort), asc(lodgingRooms.name));
  const beds = await tx
    .select()
    .from(lodgingBeds)
    .where(eq(lodgingBeds.active, true))
    .orderBy(asc(lodgingBeds.position));
  return rooms.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as RoomKind,
    soldBy: r.soldBy as RoomSoldBy,
    pricePer: r.pricePer as RoomPricePer,
    maxGuests: r.maxGuests,
    priceNightAgorot: r.priceNightAgorot,
    toilet: r.toilet as RoomFacility,
    shower: r.shower as RoomFacility,
    housekeeping: r.housekeeping as HousekeepingState,
    active: r.active,
    beds: beds.filter((b) => b.roomId === r.id).map((b) => ({ id: b.id, label: b.label })),
    bedCount: r.beds,
    note: r.note,
  }));
}

// ─── The price list ─────────────────────────────────────────────────────────

/**
 * One rule of the price list. A season has its first and last night (and may come back every year); the weekend has
 * its nights; the holidays need neither. It sets the night's price (shekels in the form, agorot here) or moves it by a
 * percent, for every room or one kind, and may ask for a minimum stay.
 */
export const RateInput = z
  .object({
    name: requiredText(60),
    kind: z.enum(RATE_KINDS, 'forms.errors.invalid'),
    startsOn: optionalDate(),
    endsOn: optionalDate(),
    yearly: checkbox().default(false),
    nightsOfWeek: z
      .array(z.coerce.number().int().min(0).max(6))
      .default([])
      .transform((v) => [...new Set(v)].sort()),
    roomKind: z
      .preprocess(
        (v) => (v === '' || v === undefined ? null : v),
        z.enum(ROOM_KINDS, 'forms.errors.invalid').nullable(),
      )
      .optional()
      .transform((v) => v ?? null),
    mode: z.enum(RATE_MODES, 'forms.errors.invalid'),
    priceNight: optionalInt(0, 10_000_000),
    percent: optionalInt(-90, 500),
    minNights: optionalInt(1, 30),
  })
  .superRefine((v, ctx) => {
    const problem = rateProblem({
      kind: v.kind,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      nightsOfWeek: v.nightsOfWeek,
      mode: v.mode,
      priceNightAgorot: v.priceNight,
      percent: v.percent,
    });
    if (problem) {
      const path =
        problem === 'lodging.errors.rateDates'
          ? 'endsOn'
          : problem === 'lodging.errors.rateNights'
            ? 'nightsOfWeek'
            : v.mode === 'fixed'
              ? 'priceNight'
              : 'percent';
      ctx.addIssue({ code: 'custom', path: [path], message: problem });
    }
  });
export type RateInput = z.input<typeof RateInput>;

export async function addRate(tx: Tx, ctx: ServiceContext, input: RateInput): Promise<string> {
  const v = RateInput.parse(input);
  const [row] = await guarded(() =>
    tx
      .insert(lodgingRates)
      .values({
        organizationId: ctx.orgId,
        name: v.name,
        kind: v.kind,
        startsOn: v.kind === 'season' ? v.startsOn : null,
        endsOn: v.kind === 'season' ? v.endsOn : null,
        yearly: v.kind === 'season' && v.yearly,
        nightsOfWeek: v.kind === 'weekend' ? v.nightsOfWeek : null,
        roomKind: v.roomKind,
        mode: v.mode,
        priceNightAgorot: v.mode === 'fixed' ? v.priceNight : null,
        percent: v.mode === 'percent' ? v.percent : null,
        minNights: v.minNights,
      })
      .returning({ id: lodgingRates.id }),
  );
  return (row as { id: string }).id;
}

export const RateToggle = z.object({ id: z.uuid(), active: checkbox() });
export type RateToggle = z.input<typeof RateToggle>;

/** Pauses a rule or turns it back on (a paused rule changes no price). */
export async function setRateActive(tx: Tx, input: RateToggle): Promise<void> {
  const v = RateToggle.parse(input);
  const done = await tx
    .update(lodgingRates)
    .set({ active: v.active })
    .where(eq(lodgingRates.id, v.id))
    .returning({ id: lodgingRates.id });
  if (!done.length) throw new DomainError('common.errors.notFound');
}

export const RateRemove = z.object({ id: z.uuid() });

/** Removes a rule. Stays already booked keep the price they were booked at. */
export async function removeRate(tx: Tx, input: z.input<typeof RateRemove>): Promise<void> {
  const v = RateRemove.parse(input);
  const done = await tx
    .delete(lodgingRates)
    .where(eq(lodgingRates.id, v.id))
    .returning({ id: lodgingRates.id });
  if (!done.length) throw new DomainError('common.errors.notFound');
}

/** Every rule of the price list: seasons by their first night, then the weekend, then the holidays. */
export async function loadRates(tx: Tx): Promise<RateFacts[]> {
  const rows = await tx.select().from(lodgingRates).orderBy(desc(lodgingRates.createdAt));
  const rank = { season: 0, weekend: 1, holiday: 2 } as const;
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as RateKind,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      yearly: r.yearly,
      nightsOfWeek: r.nightsOfWeek,
      roomKind: r.roomKind as RoomKind | null,
      mode: r.mode as RateMode,
      priceNightAgorot: r.priceNightAgorot,
      percent: r.percent,
      minNights: r.minNights,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }))
    .sort(
      (a, b) => rank[a.kind] - rank[b.kind] || (a.startsOn ?? '').localeCompare(b.startsOn ?? ''),
    );
}

/**
 * The Hebrew holidays' nights between two dates (the first night included, the last excluded): the night before a
 * holiday or one of its middle days, and the nights of the middle days (Sukkot, Pesach), as Israel keeps them.
 */
export function holidayNights(from: string, to: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let night = from; night < to; night = addDays(night, 1)) {
    const today = dayInfo(night);
    const next = dayInfo(addDays(night, 1));
    const holiday =
      next.isYomTov || next.isCholHaMoed ? next : today.isCholHaMoed ? today : undefined;
    if (holiday) out.set(night, (holiday.holidays[0]?.he ?? '').replace(/\s*\d{4}$/, ''));
  }
  return out;
}

/** Everything a search or a booking prices with, for these nights. */
export async function pricingFor(tx: Tx, from: string, to: string): Promise<Pricing> {
  const [rates, settings] = await Promise.all([loadRates(tx), getLodgingSettings(tx)]);
  return { rates, holidays: holidayNights(from, to), minNights: settings.minNights };
}

export interface HolidayNight {
  date: string;
  name: string;
}

/** The holiday nights ahead (for the price list screen): one line per night. */
export function holidaysAhead(from: string, days = 365): HolidayNight[] {
  return [...holidayNights(from, addDays(from, days))].map(([date, name]) => ({ date, name }));
}

/** One room's price for some nights (the stay screen, the bot, a booking). */
export async function quoteRoom(
  tx: Tx,
  room: RoomFacts,
  ask: { checkIn: string; checkOut: string; guests: number },
): Promise<StayQuote> {
  const pricing = await pricingFor(tx, ask.checkIn, ask.checkOut);
  return quoteStay(room, ask, pricing.rates, pricing.holidays, pricing.minNights);
}

// ─── Stays ──────────────────────────────────────────────────────────────────

/**
 * A held booking whose deposit did not come in time frees its room: it is cancelled (keeping its hold time, so a
 * payment that still arrives can bring it back while the room is free). Runs before any look at the nights.
 */
export async function releaseLapsedHolds(tx: Tx): Promise<number> {
  const done = await tx
    .update(lodgingStays)
    .set({ status: 'cancelled' })
    .where(and(eq(lodgingStays.status, 'held'), lt(lodgingStays.holdUntil, sql`now()`)))
    .returning({ id: lodgingStays.id });
  return done.length;
}

/** Stays that hold some night between `from` and `to` (cancelled ones never do). */
export async function loadStays(tx: Tx, from: string, to: string): Promise<StayFacts[]> {
  await releaseLapsedHolds(tx);
  const rows = await tx
    .select()
    .from(lodgingStays)
    .where(
      and(
        inArray(lodgingStays.status, [...STAY_HOLDING]),
        lt(lodgingStays.checkIn, to),
        gt(lodgingStays.checkOut, from),
      ),
    )
    .orderBy(asc(lodgingStays.checkIn));
  return rows.map(toFacts);
}

const toFacts = (r: typeof lodgingStays.$inferSelect): StayFacts => ({
  id: r.id,
  roomId: r.roomId,
  bedId: r.bedId,
  guestName: r.guestName,
  guests: r.guests,
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  status: r.status as StayStatus,
  ...(r.source === 'block' ? { blocked: true } : {}),
  ...(r.payAtArrival ? { payAtArrival: true } : {}),
});

export const FreeSearch = z
  .object({ checkIn: requiredDate(), checkOut: requiredDate(), guests: requiredInt(1, 60) })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'lodging.errors.dates' });
export type FreeSearch = z.infer<typeof FreeSearch>;

/** Rooms and dorm beds free for these nights that hold this many guests, cheapest first. */
export async function searchFree(tx: Tx, ask: FreeSearch): Promise<FreeOption[]> {
  const [rooms, stays, pricing] = await Promise.all([
    loadRooms(tx),
    loadStays(tx, ask.checkIn, ask.checkOut),
    pricingFor(tx, ask.checkIn, ask.checkOut),
  ]);
  return freeOptions(rooms, stays, ask, pricing);
}

export const StayInput = z
  .object({
    roomId: z.uuid(),
    bedId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().default(null)),
    guestName: requiredText(120),
    phone: optionalPhone(),
    guests: requiredInt(1, 60),
    checkIn: requiredDate(),
    checkOut: requiredDate(),
    hold: checkbox().default(false),
    /** The guest pays what is left after the deposit at the desk on arrival (the business must allow it). */
    payAtArrival: checkbox().default(false),
    note: optionalText(500),
    source: z.enum(STAY_BOOKING_SOURCES).default('office'),
    leadId: z.uuid().nullable().default(null),
  })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'lodging.errors.dates' });
export type StayInput = z.input<typeof StayInput>;

/**
 * Books a stay. A dorm booked without a named bed takes as many free beds as guests, one stay per bed (same guest
 * name), so each bed shows on the board. Returns the new stays.
 */
export async function bookStay(tx: Tx, ctx: ServiceContext, input: StayInput): Promise<string[]> {
  const v = StayInput.parse(input);
  const rooms = await loadRooms(tx);
  const room = rooms.find((r) => r.id === v.roomId);
  if (!room) throw new DomainError('common.errors.notFound');
  const stays = await loadStays(tx, v.checkIn, v.checkOut);
  const problem = stayProblem(room, v, stays);
  if (problem) throw new DomainError(problem);
  // The office may book a shorter stay than the price list asks for; the bot and online bookings may not.
  const quote = await quoteRoom(tx, room, { ...v, guests: room.soldBy === 'bed' ? 1 : v.guests });
  if (quote.tooShort && v.source !== 'office') {
    throw new DomainError('lodging.errors.tooShort', { n: quote.minNights });
  }
  const settings = await getLodgingSettings(tx);
  if (v.payAtArrival && !settings.payAtArrival)
    throw new DomainError('lodging.errors.noPayAtArrival');
  const bookingId = randomUUID();
  const until = v.hold ? holdUntil(new Date(), settings.holdHours) : null;
  const beds =
    room.soldBy === 'bed' && v.bedId === null
      ? freeBeds(room, v, stays)
          .slice(0, v.guests)
          .map((b) => b.id)
      : [v.bedId];
  const ids: string[] = [];
  for (const bedId of beds) {
    const [row] = await guarded(() =>
      tx
        .insert(lodgingStays)
        .values({
          organizationId: ctx.orgId,
          roomId: room.id,
          bedId,
          guestName: v.guestName,
          phoneE164: v.phone,
          guests: bedId ? 1 : v.guests,
          checkIn: v.checkIn,
          checkOut: v.checkOut,
          status: v.hold ? 'held' : 'confirmed',
          bookingId,
          holdUntil: until,
          source: v.source,
          note: v.note,
          leadId: v.leadId,
          totalAgorot: quote.totalAgorot,
          payAtArrival: v.payAtArrival,
        })
        .returning({ id: lodgingStays.id }),
    );
    ids.push((row as { id: string }).id);
  }
  return ids;
}

export const BlockInput = z
  .object({
    roomId: z.uuid(),
    bedId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().default(null)),
    from: requiredDate(),
    to: requiredDate(),
    reason: requiredText(120),
  })
  .refine((v) => v.to > v.from, { path: ['to'], message: 'lodging.errors.dates' });
export type BlockInput = z.input<typeof BlockInput>;

/**
 * Closes a room (or one bed of a dorm) for repair from `from` until `to` (the first night it is open again): nobody can
 * book those nights, the board shows them closed, and the morning brief leaves the room out. A night already sold
 * cannot be closed (the booking moves first).
 */
export async function blockRoom(tx: Tx, ctx: ServiceContext, input: BlockInput): Promise<string> {
  const v = BlockInput.parse(input);
  const rooms = await loadRooms(tx);
  const room = rooms.find((r) => r.id === v.roomId);
  if (!room) throw new DomainError('common.errors.notFound');
  if (v.bedId && !room.beds.some((b) => b.id === v.bedId)) {
    throw new DomainError('common.errors.notFound');
  }
  const nights = { checkIn: v.from, checkOut: v.to };
  if (nightsBetween(v.from, v.to) > 365) throw new DomainError('lodging.errors.tooLong');
  const stays = await loadStays(tx, v.from, v.to);
  // The whole room, or the one bed: free on every night (a dorm closed whole needs all its beds free).
  if (!isFree(room, v.bedId, nights, stays)) throw new DomainError('lodging.errors.blockTaken');
  const [row] = await guarded(() =>
    tx
      .insert(lodgingStays)
      .values({
        organizationId: ctx.orgId,
        roomId: room.id,
        bedId: v.bedId,
        guestName: v.reason,
        guests: 1,
        checkIn: v.from,
        checkOut: v.to,
        status: 'confirmed',
        source: 'block',
      })
      .returning({ id: lodgingStays.id }),
  );
  return (row as { id: string }).id;
}

export const STAY_MOVES = ['confirm', 'check_in', 'check_out', 'cancel'] as const;
export const StayMove = z.object({ id: z.uuid(), move: z.enum(STAY_MOVES) });
export type StayMove = z.infer<typeof StayMove>;

/** Which statuses each move starts from, and where it leads. */
const MOVES: Record<(typeof STAY_MOVES)[number], { from: StayStatus[]; to: StayStatus }> = {
  confirm: { from: ['held'], to: 'confirmed' },
  check_in: { from: ['held', 'confirmed'], to: 'checked_in' },
  check_out: { from: ['checked_in', 'confirmed'], to: 'checked_out' },
  cancel: { from: ['held', 'confirmed'], to: 'cancelled' },
};

/** Moves a stay along: confirm a held one, check in, check out (the room then waits to be made up), or cancel. */
export async function moveStay(tx: Tx, input: StayMove): Promise<void> {
  const v = StayMove.parse(input);
  const rule = MOVES[v.move];
  const now = new Date();
  // A block is not a guest: it only ends (opened again), never checks in or out.
  const [current] = await tx
    .select({ source: lodgingStays.source })
    .from(lodgingStays)
    .where(eq(lodgingStays.id, v.id));
  if (current?.source === 'block' && v.move !== 'cancel') {
    throw new DomainError('lodging.errors.cannotMove');
  }
  const done = await guarded(() =>
    tx
      .update(lodgingStays)
      .set({
        status: rule.to,
        // Confirmed or cancelled by the office: no longer waiting for a deposit.
        ...(v.move === 'confirm' || v.move === 'cancel' ? { holdUntil: null } : {}),
        ...(v.move === 'check_in' ? { checkedInAt: now } : {}),
        ...(v.move === 'check_out' ? { checkedOutAt: now } : {}),
      })
      .where(and(eq(lodgingStays.id, v.id), inArray(lodgingStays.status, rule.from)))
      .returning({ id: lodgingStays.id }),
  );
  if (!done.length) throw new DomainError('lodging.errors.cannotMove');
}

export interface StayView extends StayFacts {
  roomName: string;
  bedLabel: string | null;
  phoneE164: string | null;
  note: string | null;
  source: string;
  nights: number;
  totalAgorot: number | null;
  bookingId: string;
  holdUntil: Date | null;
  payAtArrival: boolean;
}

export async function getStay(tx: Tx, id: string): Promise<StayView | null> {
  const [row] = await tx.select().from(lodgingStays).where(eq(lodgingStays.id, id));
  if (!row) return null;
  const rooms = await loadRooms(tx);
  const room = rooms.find((r) => r.id === row.roomId);
  const [bed] = row.bedId
    ? await tx.select().from(lodgingBeds).where(eq(lodgingBeds.id, row.bedId))
    : [];
  const nights = nightsBetween(row.checkIn, row.checkOut);
  return {
    ...toFacts(row),
    roomName: room?.name ?? '',
    bedLabel: bed?.label ?? null,
    phoneE164: row.phoneE164,
    note: row.note,
    source: row.source,
    nights,
    // The price when booked (the price list may have changed since).
    totalAgorot: row.totalAgorot,
    bookingId: row.bookingId,
    holdUntil: row.holdUntil,
    payAtArrival: row.payAtArrival,
  };
}

// ─── The board and the day ──────────────────────────────────────────────────

export async function lodgingBoard(
  tx: Tx,
  from: string,
  nights: number,
): Promise<{ rows: BoardRow[]; rooms: RoomRow[] }> {
  const rooms = await loadRooms(tx);
  const stays = await loadStays(tx, from, addDays(from, nights));
  return { rows: boardRows(rooms, stays, from, nights), rooms };
}

export interface LodgingDay {
  settings: LodgingSettingsView;
  rooms: RoomRow[];
  plan: DayPlan;
  /** Every stay that is part of today, for names and links. */
  stays: StayFacts[];
  /** What each of today's arrivals still owes, for the desk to collect (stays that owe nothing left out). */
  collect: Record<string, number>;
}

/**
 * What these stays' bookings still owe: the price booked (cancelled beds left out) less what came in. The desk collects
 * it on arrival; stays that owe nothing, or have no price, are left out.
 */
export async function dueByStay(
  tx: Tx,
  stayIds: readonly string[],
): Promise<Record<string, number>> {
  if (!stayIds.length) return {};
  const mine = await tx
    .select({ id: lodgingStays.id, bookingId: lodgingStays.bookingId })
    .from(lodgingStays)
    .where(inArray(lodgingStays.id, [...stayIds]));
  const bookingIds = [...new Set(mine.map((r) => r.bookingId))];
  const [stays, payments] = await Promise.all([
    tx.select().from(lodgingStays).where(inArray(lodgingStays.bookingId, bookingIds)),
    tx
      .select({
        bookingId: lodgingPayments.bookingId,
        kind: lodgingPayments.kind,
        amountAgorot: lodgingPayments.amountAgorot,
      })
      .from(lodgingPayments)
      .where(inArray(lodgingPayments.bookingId, bookingIds)),
  ]);
  const due = new Map<string, number>();
  for (const bookingId of bookingIds) {
    const all = stays.filter((s) => s.bookingId === bookingId);
    const live = all.filter((s) => s.status !== 'cancelled');
    const priced = live.length ? live : all;
    const total = priced.some((s) => s.totalAgorot === null)
      ? null
      : priced.reduce((sum, s) => sum + (s.totalAgorot ?? 0), 0);
    const lines = payments
      .filter((p) => p.bookingId === bookingId)
      .map((p) => ({ kind: p.kind as LodgingPaymentKind, amountAgorot: p.amountAgorot }));
    due.set(bookingId, bookingMoney(total, lines, 0).dueAgorot ?? 0);
  }
  const out: Record<string, number> = {};
  for (const r of mine) {
    const amount = due.get(r.bookingId) ?? 0;
    if (amount > 0) out[r.id] = amount;
  }
  return out;
}

export async function lodgingDay(tx: Tx, date?: string): Promise<LodgingDay> {
  const day = date ?? (await todayIL(tx));
  const [settings, rooms, stays] = await Promise.all([
    getLodgingSettings(tx),
    loadRooms(tx),
    loadStays(tx, addDays(day, -1), addDays(day, 2)),
  ]);
  const plan = dayPlan(rooms, stays, day);
  const collect = await dueByStay(
    tx,
    plan.arrivals.map((s) => s.id),
  );
  return { settings, rooms, plan, stays, collect };
}

/**
 * The morning WhatsApp (07:00): today's arrivals, departures and rooms to prepare, to the lodging's own number or, without
 * one, the owner's approvals number. Once a day; nothing when lodging is off, the brief is off, or no room is set up.
 */
export async function sendMorningBrief(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ sent: boolean; reason?: string }> {
  const settings = await getLodgingSettings(tx);
  if (!settings.enabled) return { sent: false, reason: 'off' };
  if (!settings.morningBrief) return { sent: false, reason: 'brief_off' };
  const phone = settings.briefPhoneE164 ?? (await getAgentSettings(tx)).approvalPhoneE164;
  if (!phone) return { sent: false, reason: 'no_phone' };
  const { rooms, plan, collect } = await lodgingDay(tx);
  if (!rooms.some((r) => r.active)) return { sent: false, reason: 'no_rooms' };
  const out = await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: phone,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: (locale) => ({
      text: briefText(
        plan,
        rooms,
        { checkIn: settings.checkInTime, checkOut: settings.checkOutTime },
        locale,
        collect,
      ),
    }),
    idempotencyKey: `lodging.brief:${plan.date}`,
  });
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
