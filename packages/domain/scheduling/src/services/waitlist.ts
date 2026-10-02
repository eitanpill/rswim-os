/** The waitlist (brief §5 waitlist_entries) and "open a new group?" suggestions from its clusters (brief §6.1). */
import { z } from 'zod';
import { optionalText, requiredInt, TimeOfDay } from '@rswim/contracts';
import { and, asc, desc, eq, inArray, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { ageInMonths, waitlistClusters, type Cluster } from '../policies';
import { placeStudent } from './board';
import { byIds, optionalUuid, todayIL } from './shared';

const { waitlistEntries } = schema;

const optionalTime = () =>
  z.preprocess((v) => (v === '' ? undefined : v), TimeOfDay.optional()).transform((v) => v ?? null);

export const WaitlistInput = z.object({
  studentId: z.uuid(),
  programId: z.uuid(),
  venueId: optionalUuid(),
  classTemplateId: optionalUuid(),
  preferredWeekdays: z.array(requiredInt(0, 6)).default([]),
  earliestAt: optionalTime(),
  latestAt: optionalTime(),
  priority: requiredInt(0, 9).default(0),
  notes: optionalText(300),
});
export type WaitlistInput = z.infer<typeof WaitlistInput>;

export async function addToWaitlist(tx: Tx, ctx: ServiceContext, input: WaitlistInput) {
  const existing = await tx
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.studentId, input.studentId),
        eq(waitlistEntries.programId, input.programId),
        eq(waitlistEntries.status, 'waiting'),
      ),
    );
  if (existing.length) throw new DomainError('scheduling.errors.alreadyWaiting');
  const [row] = await tx
    .insert(waitlistEntries)
    .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
    .returning({ id: waitlistEntries.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.waitlist_added',
    payload: { entryId: id, studentId: input.studentId, programId: input.programId },
    idempotencyKey: `scheduling.waitlist_added:${id}`,
  });
  return id;
}

export async function withdrawFromWaitlist(tx: Tx, id: string) {
  await tx.update(waitlistEntries).set({ status: 'withdrawn' }).where(eq(waitlistEntries.id, id));
}

/** Waiting children, ranked: higher priority first, then who asked first. */
export async function listWaitlist(tx: Tx, statuses: readonly string[] = ['waiting', 'offered']) {
  const rows = await tx
    .select()
    .from(waitlistEntries)
    .where(inArray(waitlistEntries.status, [...statuses]))
    .orderBy(desc(waitlistEntries.priority), asc(waitlistEntries.createdAt));
  const today = await todayIL(tx);
  const kids = byIds(
    await studentsByIds(
      tx,
      rows.map((r) => r.studentId),
    ),
  );
  return rows.map((r) => {
    const s = kids.get(r.studentId);
    return {
      ...r,
      student: s ?? null,
      ageMonths: s?.dob ? ageInMonths(s.dob, today) : null,
    };
  });
}

/** Places a waiting child into a group (every hard rule applies) and marks the entry placed. */
export async function placeFromWaitlist(
  tx: Tx,
  ctx: ServiceContext,
  entryId: string,
  input: { toTemplateId: string; onDate: string },
) {
  const [entry] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId));
  if (!entry || entry.status === 'placed' || entry.status === 'withdrawn') {
    throw new DomainError('common.errors.notFound');
  }
  const { enrollmentId } = await placeStudent(tx, ctx, {
    studentId: entry.studentId,
    toTemplateId: input.toTemplateId,
    fromTemplateId: null,
    onDate: input.onDate,
    status: 'active',
  });
  await tx
    .update(waitlistEntries)
    .set({ status: 'placed', placedEnrollmentId: enrollmentId })
    .where(eq(waitlistEntries.id, entryId));
  return enrollmentId;
}

/** Clusters big enough to suggest a new group, by the org's `scheduling.open_group_min_waiting`. */
export async function groupSuggestions(tx: Tx): Promise<Cluster[]> {
  const today = await todayIL(tx);
  const policy = await resolvePolicyFor(tx, { date: today });
  const entries = await listWaitlist(tx, ['waiting']);
  return waitlistClusters(
    entries.map((e) => ({
      id: e.id,
      programId: e.programId,
      venueId: e.venueId,
      preferredWeekdays: e.preferredWeekdays,
      earliestAt: e.earliestAt,
      ageMonths: e.ageMonths,
    })),
    policy.rules.scheduling?.open_group_min_waiting ?? 5,
  );
}
