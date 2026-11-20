/**
 * Lodging (docs/LODGING.md): the business sets up its rooms (kind, beds, guests, toilet and shower, price), the office
 * books stays on the board, checks guests in and out, and marks rooms made up. Every morning reception (or the owner)
 * hears today's arrivals, departures and rooms to prepare on WhatsApp. One module for swim schools and freediving
 * clubs; the office of each (owner and admins) runs it.
 */
import { z } from 'zod';
import {
  checkbox,
  HOUSEKEEPING_STATES,
  optionalInt,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
  ROOM_FACILITIES,
  ROOM_KINDS,
  STAY_HOLDING,
  STAY_SOURCES,
  type HousekeepingState,
  type RoomFacility,
  type RoomKind,
  type RoomSoldBy,
  type StayStatus,
} from '@rswim/contracts';
import { and, asc, eq, gt, inArray, lt, schema, sql, type Tx } from '@rswim/db';
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
  nightsBetween,
  roomNames,
  soldByFor,
  stayProblem,
  type BoardRow,
  type DayPlan,
  type FreeOption,
  type RoomFacts,
  type StayFacts,
} from './policies';

const { lodgingSettings, lodgingRooms, lodgingBeds, lodgingStays } = schema;

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
});
export type LodgingSettingsInput = z.infer<typeof LodgingSettingsInput>;

export interface LodgingSettingsView {
  enabled: boolean;
  checkInTime: string;
  checkOutTime: string;
  morningBrief: boolean;
  briefPhoneE164: string | null;
}

export async function getLodgingSettings(tx: Tx): Promise<LodgingSettingsView> {
  const [row] = await tx.select().from(lodgingSettings).limit(1);
  return {
    enabled: row?.enabled ?? false,
    checkInTime: row?.checkInTime ?? '15:00',
    checkOutTime: row?.checkOutTime ?? '11:00',
    morningBrief: row?.morningBrief ?? true,
    briefPhoneE164: row?.briefPhoneE164 ?? null,
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
  note: optionalText(500),
};

/**
 * One room, or several of the same kind at once ("חדר משפחה" ×4 → "חדר משפחה 1"…"4"). A dorm sleeps one guest a bed,
 * so its guests are its beds whatever the form says.
 */
export const RoomInput = z.object({ ...roomFields, count: requiredInt(1, 50).default(1) });
export type RoomInput = z.infer<typeof RoomInput>;

export const RoomUpdate = z.object({ id: z.uuid(), ...roomFields, active: checkbox() });
export type RoomUpdate = z.infer<typeof RoomUpdate>;

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

// ─── Stays ──────────────────────────────────────────────────────────────────

/** Stays that hold some night between `from` and `to` (cancelled ones never do). */
export async function loadStays(tx: Tx, from: string, to: string): Promise<StayFacts[]> {
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
});

export const FreeSearch = z
  .object({ checkIn: requiredDate(), checkOut: requiredDate(), guests: requiredInt(1, 60) })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'lodging.errors.dates' });
export type FreeSearch = z.infer<typeof FreeSearch>;

/** Rooms and dorm beds free for these nights that hold this many guests, cheapest first. */
export async function searchFree(tx: Tx, ask: FreeSearch): Promise<FreeOption[]> {
  const [rooms, stays] = await Promise.all([
    loadRooms(tx),
    loadStays(tx, ask.checkIn, ask.checkOut),
  ]);
  return freeOptions(rooms, stays, ask);
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
    note: optionalText(500),
    source: z.enum(STAY_SOURCES).default('office'),
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
          source: v.source,
          note: v.note,
          leadId: v.leadId,
        })
        .returning({ id: lodgingStays.id }),
    );
    ids.push((row as { id: string }).id);
  }
  return ids;
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
  const done = await guarded(() =>
    tx
      .update(lodgingStays)
      .set({
        status: rule.to,
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
    // A room's price is per night for the whole room, a dorm's per bed; a stay is one room or one bed.
    totalAgorot: room?.priceNightAgorot == null ? null : room.priceNightAgorot * nights,
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
}

export async function lodgingDay(tx: Tx, date?: string): Promise<LodgingDay> {
  const day = date ?? (await todayIL(tx));
  const [settings, rooms, stays] = await Promise.all([
    getLodgingSettings(tx),
    loadRooms(tx),
    loadStays(tx, addDays(day, -1), addDays(day, 2)),
  ]);
  return { settings, rooms, plan: dayPlan(rooms, stays, day), stays };
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
  const { rooms, plan } = await lodgingDay(tx);
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
      ),
    }),
    idempotencyKey: `lodging.brief:${plan.date}`,
  });
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
