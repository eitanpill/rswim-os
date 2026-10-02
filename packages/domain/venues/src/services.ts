/**
 * Venue services (brief §6.2). Each function runs inside the caller's transaction, which already carries the
 * user's identity (asUser) or the job's org (withOrg), so RLS decides what it may touch.
 */
import { z } from 'zod';
import {
  CLOSURE_SOURCES,
  CONTRACT_KINDS,
  GENDER_RESTRICTIONS,
  optionalDate,
  optionalInt,
  optionalText,
  RENT_MODELS,
  requiredDate,
  requiredInt,
  requiredText,
  TimeOfDay,
  VENUE_KINDS,
  VENUE_STATUSES,
} from '@rswim/contracts';
import { asc, eq, inArray, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { validateWindow, type WindowInput } from './policies';

const {
  venues,
  pools,
  lanes,
  venueOperatingWindows,
  operatingWindowLanes,
  venueClosures,
  venueContracts,
} = schema;

// ─── Inputs ─────────────────────────────────────────────────────────────────

export const VenueInput = z.object({
  name: requiredText(120),
  kind: z.enum(VENUE_KINDS),
  status: z.enum(VENUE_STATUSES),
  address: optionalText(300),
  city: optionalText(100),
  parkingInstructions: optionalText(),
  entryInstructions: optionalText(),
  frontDeskScript: optionalText(),
  notes: optionalText(),
});
export type VenueInput = z.infer<typeof VenueInput>;

export const PoolInput = z.object({
  name: requiredText(80),
  indoor: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  tempMinC: optionalInt(0, 40),
  tempMaxC: optionalInt(0, 40),
  depthMinCm: optionalInt(0, 600),
  depthMaxCm: optionalInt(0, 600),
  laneCount: requiredInt(1, 20),
});
export type PoolInput = z.infer<typeof PoolInput>;

export const WindowFormInput = z.object({
  poolId: z.uuid(),
  weekday: requiredInt(0, 6),
  startsAt: TimeOfDay,
  endsAt: TimeOfDay,
  genderRestriction: z.enum(GENDER_RESTRICTIONS),
  effectiveFrom: requiredDate(),
  effectiveTo: optionalDate(),
  laneIds: z.array(z.uuid()).min(1, 'venues.errors.noLanes'),
  notes: optionalText(300),
});
export type WindowFormInput = z.infer<typeof WindowFormInput>;

export const ClosureInput = z
  .object({
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    source: z.enum(CLOSURE_SOURCES),
    reason: requiredText(300),
  })
  .refine((c) => c.endsOn >= c.startsOn, {
    message: 'venues.errors.datesReversed',
    path: ['endsOn'],
  });
export type ClosureInput = z.infer<typeof ClosureInput>;

export const ContractInput = z.object({
  kind: z.enum(CONTRACT_KINDS),
  rentModel: z.enum(RENT_MODELS),
  amountAgorot: z.int().min(0),
  startsOn: optionalDate(),
  endsOn: optionalDate(),
  renewalOn: optionalDate(),
  notes: optionalText(),
});
export type ContractInput = z.infer<typeof ContractInput>;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listVenues(tx: Tx) {
  return tx.select().from(venues).orderBy(asc(venues.status), asc(venues.name));
}

export type VenueDetail = NonNullable<Awaited<ReturnType<typeof getVenue>>>;

export async function getVenue(tx: Tx, venueId: string) {
  const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId));
  if (!venue) return null;
  const poolRows = await tx
    .select()
    .from(pools)
    .where(eq(pools.venueId, venueId))
    .orderBy(asc(pools.name));
  const poolIds = poolRows.map((p) => p.id);
  const laneRows = poolIds.length
    ? await tx
        .select()
        .from(lanes)
        .where(inArray(lanes.poolId, poolIds))
        .orderBy(asc(lanes.ordinal))
    : [];
  const windowRows = await tx
    .select()
    .from(venueOperatingWindows)
    .where(eq(venueOperatingWindows.venueId, venueId))
    .orderBy(asc(venueOperatingWindows.weekday), asc(venueOperatingWindows.startsAt));
  const windowLaneRows = windowRows.length
    ? await tx
        .select()
        .from(operatingWindowLanes)
        .where(
          inArray(
            operatingWindowLanes.windowId,
            windowRows.map((w) => w.id),
          ),
        )
    : [];
  const closures = await tx
    .select()
    .from(venueClosures)
    .where(eq(venueClosures.venueId, venueId))
    .orderBy(asc(venueClosures.startsOn));
  // Contracts are hidden from instructors by RLS; the query simply returns nothing for them.
  const contracts = await tx
    .select()
    .from(venueContracts)
    .where(eq(venueContracts.venueId, venueId));
  return {
    venue,
    pools: poolRows.map((p) => ({ ...p, lanes: laneRows.filter((l) => l.poolId === p.id) })),
    windows: windowRows.map((w) => ({
      ...w,
      laneIds: windowLaneRows.filter((x) => x.windowId === w.id).map((x) => x.laneId),
    })),
    closures,
    contracts,
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function createVenue(tx: Tx, ctx: ServiceContext, input: VenueInput): Promise<string> {
  const [row] = await tx
    .insert(venues)
    .values({ ...input, organizationId: ctx.orgId })
    .returning({ id: venues.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'venues.venue_created',
    payload: { venueId: id, status: input.status },
    idempotencyKey: `venues.venue_created:${id}`,
  });
  return id;
}

export async function updateVenue(tx: Tx, ctx: ServiceContext, venueId: string, input: VenueInput) {
  const [before] = await tx
    .select({ status: venues.status })
    .from(venues)
    .where(eq(venues.id, venueId));
  if (!before) throw new DomainError('common.errors.notFound');
  await tx.update(venues).set(input).where(eq(venues.id, venueId));
  if (before.status !== input.status) {
    // Phase 3 (closure workflow) and Phase 9 (migration wizard) react to status changes.
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'venues.status_changed',
      payload: { venueId, from: before.status, to: input.status },
      idempotencyKey: `venues.status_changed:${venueId}:${before.status}:${input.status}:${Date.now()}`,
    });
  }
}

export async function createPool(tx: Tx, ctx: ServiceContext, venueId: string, input: PoolInput) {
  const { laneCount, ...pool } = input;
  const [row] = await tx
    .insert(pools)
    .values({ ...pool, venueId, organizationId: ctx.orgId })
    .returning({ id: pools.id });
  const poolId = (row as { id: string }).id;
  await tx.insert(lanes).values(
    Array.from({ length: laneCount }, (_, i) => ({
      organizationId: ctx.orgId,
      poolId,
      label: String(i + 1),
      ordinal: i + 1,
    })),
  );
  return poolId;
}

export async function deletePool(tx: Tx, poolId: string) {
  await tx.delete(pools).where(eq(pools.id, poolId));
}

/** A pool's operating windows with their lanes (used by the window editor and by scheduling). */
export async function windowsOfPool(tx: Tx, poolId: string): Promise<WindowInput[]> {
  const rows = await tx
    .select()
    .from(venueOperatingWindows)
    .where(eq(venueOperatingWindows.poolId, poolId));
  const links = rows.length
    ? await tx
        .select()
        .from(operatingWindowLanes)
        .where(
          inArray(
            operatingWindowLanes.windowId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    id: r.id,
    poolId: r.poolId,
    weekday: r.weekday,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    genderRestriction: r.genderRestriction as WindowInput['genderRestriction'],
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    laneIds: links.filter((l) => l.windowId === r.id).map((l) => l.laneId),
  }));
}

/** Creates or replaces a window after checking it against the pool's other windows. */
export async function saveWindow(
  tx: Tx,
  ctx: ServiceContext,
  venueId: string,
  input: WindowFormInput,
  windowId?: string,
): Promise<string> {
  const errors = validateWindow({ ...input, id: windowId }, await windowsOfPool(tx, input.poolId));
  const first = errors[0];
  if (first) {
    throw new DomainError(
      first.code,
      first.code === 'venues.errors.laneOverlap' ? { lanes: first.laneIds.length } : {},
    );
  }
  const values = {
    poolId: input.poolId,
    weekday: input.weekday,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    genderRestriction: input.genderRestriction,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    notes: input.notes,
  };
  let id = windowId;
  if (id) {
    await tx.update(venueOperatingWindows).set(values).where(eq(venueOperatingWindows.id, id));
    await tx.delete(operatingWindowLanes).where(eq(operatingWindowLanes.windowId, id));
  } else {
    const [row] = await tx
      .insert(venueOperatingWindows)
      .values({ ...values, venueId, organizationId: ctx.orgId })
      .returning({ id: venueOperatingWindows.id });
    id = (row as { id: string }).id;
  }
  await tx.insert(operatingWindowLanes).values(
    input.laneIds.map((laneId) => ({
      organizationId: ctx.orgId,
      poolId: input.poolId,
      windowId: id,
      laneId,
    })),
  );
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'venues.window_changed',
    payload: { venueId, windowId: id },
    idempotencyKey: `venues.window_changed:${id}:${Date.now()}`,
  });
  return id;
}

export async function deleteWindow(tx: Tx, ctx: ServiceContext, venueId: string, windowId: string) {
  await tx.delete(venueOperatingWindows).where(eq(venueOperatingWindows.id, windowId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'venues.window_changed',
    payload: { venueId, windowId, deleted: true },
    idempotencyKey: `venues.window_changed:${windowId}:deleted`,
  });
}

export async function addClosure(
  tx: Tx,
  ctx: ServiceContext,
  venueId: string,
  input: ClosureInput,
) {
  const [row] = await tx
    .insert(venueClosures)
    .values({
      ...input,
      venueId,
      organizationId: ctx.orgId,
      createdBy: ctx.userId,
      announcedAt: new Date(),
    })
    .returning({ id: venueClosures.id });
  const id = (row as { id: string }).id;
  // Phase 3's closure workflow consumes this to find affected sessions and issue makeup credits.
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'venues.closure_added',
    payload: {
      venueId,
      closureId: id,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      source: input.source,
    },
    idempotencyKey: `venues.closure_added:${id}`,
  });
  return id;
}

export async function deleteClosure(tx: Tx, closureId: string) {
  await tx.delete(venueClosures).where(eq(venueClosures.id, closureId));
}

export async function addContract(
  tx: Tx,
  ctx: ServiceContext,
  venueId: string,
  input: ContractInput,
) {
  await tx.insert(venueContracts).values({ ...input, venueId, organizationId: ctx.orgId });
}

export async function deleteContract(tx: Tx, contractId: string) {
  await tx.delete(venueContracts).where(eq(venueContracts.id, contractId));
}
