/**
 * Schools, routes and riders (brief §6.10): the office sets up which school a route picks children up from, which
 * after-school group it brings them to, on which weekdays, with which escort, and where each child gets off on the way
 * back.
 */
import { z } from 'zod';
import {
  optionalDate,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
  TimeOfDay,
} from '@rswim/contracts';
import { and, asc, eq, inArray, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { staffNames, studentsByIds } from '@rswim/domain-people';
import { groupTexts } from '@rswim/domain-scheduling';

const { routeRiders, schools, transportRoutes } = schema;

export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

// ─── Schools ────────────────────────────────────────────────────────────────

export const SchoolInput = z.object({
  name: requiredText(120),
  address: optionalText(200),
  contactName: optionalText(120),
  contactPhone: optionalPhone(),
  notes: optionalText(1000),
});
export type SchoolInput = z.input<typeof SchoolInput>;

export async function createSchool(tx: Tx, ctx: ServiceContext, raw: SchoolInput) {
  const input = SchoolInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(schools)
      .values({ organizationId: ctx.orgId, ...input })
      .returning({ id: schools.id }),
  );
  return (row as { id: string }).id;
}

export async function updateSchool(tx: Tx, id: string, raw: SchoolInput) {
  const input = SchoolInput.parse(raw);
  await guarded(() => tx.update(schools).set(input).where(eq(schools.id, id)));
}

export async function listSchools(tx: Tx) {
  return tx.select().from(schools).orderBy(asc(schools.name));
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const weekdays = z
  .array(z.coerce.number().int().min(0).max(6))
  .min(1, 'transport.errors.weekdays')
  .transform((d) => [...new Set(d)].sort());

export const RouteInput = z.object({
  name: requiredText(120),
  schoolId: z.uuid('forms.errors.required'),
  classTemplateId: z.uuid('forms.errors.required'),
  weekdays,
  leavesSchoolAt: TimeOfDay,
  rideMinutes: requiredInt(0, 180),
  escortStaffId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()).default(null),
  vehicle: optionalText(120),
  driverName: optionalText(120),
  driverPhone: optionalPhone(),
  notes: optionalText(1000),
});
export type RouteInput = z.input<typeof RouteInput>;

export async function createRoute(tx: Tx, ctx: ServiceContext, raw: RouteInput) {
  const input = RouteInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(transportRoutes)
      .values({ organizationId: ctx.orgId, ...input })
      .returning({ id: transportRoutes.id }),
  );
  return (row as { id: string }).id;
}

export async function updateRoute(tx: Tx, id: string, raw: RouteInput) {
  const input = RouteInput.parse(raw);
  await guarded(() => tx.update(transportRoutes).set(input).where(eq(transportRoutes.id, id)));
}

export async function setRouteActive(tx: Tx, id: string, active: boolean) {
  await tx.update(transportRoutes).set({ active }).where(eq(transportRoutes.id, id));
}

export type RouteView = typeof transportRoutes.$inferSelect & {
  schoolName: string;
  groupName: string;
  venueName: string;
  lessonTime: string;
  escortName: string | null;
  riders: number;
};

/** Routes with the words the screens show (school, group, venue, escort) and how many children ride now. */
export async function listRoutes(tx: Tx, ids?: readonly string[]): Promise<RouteView[]> {
  const rows = await tx
    .select()
    .from(transportRoutes)
    .where(ids ? inArray(transportRoutes.id, [...ids]) : undefined)
    .orderBy(asc(transportRoutes.name));
  if (rows.length === 0) return [];
  const [schoolRows, groups, escorts, counts] = await Promise.all([
    tx.select({ id: schools.id, name: schools.name }).from(schools),
    groupTexts(
      tx,
      rows.map((r) => r.classTemplateId),
    ),
    staffNames(
      tx,
      rows.flatMap((r) => (r.escortStaffId ? [r.escortStaffId] : [])),
    ),
    tx
      .select({ routeId: routeRiders.routeId, n: sql<number>`count(*)::int` })
      .from(routeRiders)
      .where(isNull(routeRiders.endsOn))
      .groupBy(routeRiders.routeId),
  ]);
  const school = new Map(schoolRows.map((s) => [s.id, s.name]));
  const group = new Map(groups.map((g) => [g.id, g]));
  const count = new Map(counts.map((c) => [c.routeId, c.n]));
  return rows.map((r) => ({
    ...r,
    schoolName: school.get(r.schoolId) ?? '',
    groupName: group.get(r.classTemplateId)?.name ?? '',
    venueName: group.get(r.classTemplateId)?.venueName ?? '',
    lessonTime: group.get(r.classTemplateId)?.time ?? '',
    escortName: r.escortStaffId ? (escorts.get(r.escortStaffId) ?? null) : null,
    riders: count.get(r.id) ?? 0,
  }));
}

export async function getRoute(tx: Tx, id: string): Promise<RouteView | null> {
  const [r] = await listRoutes(tx, [id]);
  return r ?? null;
}

// ─── Riders ─────────────────────────────────────────────────────────────────

export const RiderInput = z.object({
  routeId: z.uuid(),
  studentId: z.uuid('forms.errors.required'),
  dropoffPoint: optionalText(200),
  dropoffNote: optionalText(500),
  startsOn: requiredDate(),
});
export type RiderInput = z.input<typeof RiderInput>;

/** Puts a child on a route; a child already riding it gets an error rather than a second seat. */
export async function addRider(tx: Tx, ctx: ServiceContext, raw: RiderInput) {
  const input = RiderInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(routeRiders)
      .values({ organizationId: ctx.orgId, ...input })
      .onConflictDoNothing()
      .returning({ id: routeRiders.id }),
  );
  if (!row) throw new DomainError('transport.errors.alreadyRiding');
  return row.id;
}

export const RiderPointInput = z.object({
  id: z.uuid(),
  dropoffPoint: optionalText(200),
  dropoffNote: optionalText(500),
});

export async function updateRiderPoint(tx: Tx, raw: z.input<typeof RiderPointInput>) {
  const input = RiderPointInput.parse(raw);
  await tx
    .update(routeRiders)
    .set({ dropoffPoint: input.dropoffPoint, dropoffNote: input.dropoffNote })
    .where(eq(routeRiders.id, input.id));
}

export const EndRiderInput = z.object({ id: z.uuid(), endsOn: optionalDate() });

/** Takes a child off a route from a date (the last day they ride is the day before). */
export async function endRider(tx: Tx, raw: z.input<typeof EndRiderInput>, today: string) {
  const input = EndRiderInput.parse(raw);
  await guarded(() =>
    tx
      .update(routeRiders)
      .set({ endsOn: input.endsOn ?? today })
      .where(and(eq(routeRiders.id, input.id), isNull(routeRiders.endsOn))),
  );
}

export type RiderView = typeof routeRiders.$inferSelect & { name: string; householdId: string };

/** The children on routes on a date (or riding now when no date), with their names. */
export async function ridersOf(
  tx: Tx,
  routeIds: readonly string[],
  date?: string,
): Promise<RiderView[]> {
  if (routeIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(routeRiders)
    .where(
      and(
        inArray(routeRiders.routeId, [...routeIds]),
        date
          ? sql`${routeRiders.startsOn} <= ${date}::date and (${routeRiders.endsOn} is null or ${routeRiders.endsOn} > ${date}::date)`
          : isNull(routeRiders.endsOn),
      ),
    );
  const kids = await studentsByIds(
    tx,
    rows.map((r) => r.studentId),
  );
  const kid = new Map(kids.map((k) => [k.id, k]));
  return rows
    .map((r) => ({
      ...r,
      name: kid.has(r.studentId)
        ? `${kid.get(r.studentId)?.firstName} ${kid.get(r.studentId)?.lastName}`
        : '',
      householdId: kid.get(r.studentId)?.householdId ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Routes a child rides now (the parent's child card, the family's transport status). */
export async function routesOfStudents(tx: Tx, studentIds: readonly string[]) {
  if (studentIds.length === 0) return [];
  return tx
    .select()
    .from(routeRiders)
    .where(and(inArray(routeRiders.studentId, [...studentIds]), isNull(routeRiders.endsOn)));
}
