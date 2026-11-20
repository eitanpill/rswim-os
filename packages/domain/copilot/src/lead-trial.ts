/**
 * A new customer's trial lesson, booked by the WhatsApp bot through the brain (WhatsApp track W3, kind `book_trial`).
 * The family is opened from the lead (the parent's phone is the lead's, WhatsApp on: they wrote first), the child is
 * added and the trial booked in the chosen lesson with the usual placement rules. The lead follows by itself: the
 * guardian's phone links it to the family and the trial seat moves it to "trial booked" (migration 0065's triggers),
 * and the trial confirmation goes out like any trial the office books.
 */
import { eq, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { bookTrial, cancelTrial } from '@rswim/domain-enrollment';
import {
  addStudent,
  createHousehold,
  GuardianInput,
  HouseholdInput,
  StudentInput,
} from '@rswim/domain-people';
import type { ProposalParams } from './policies';

const { leads } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

export async function bookLeadTrial(
  tx: Tx,
  ctx: ServiceContext,
  p: ProposalParams['book_trial'],
): Promise<{ trialId: string; householdId: string; studentId: string }> {
  const [lead] = await tx
    .select({ phone: leads.phoneE164, householdId: leads.householdId })
    .from(leads)
    .where(eq(leads.id, p.leadId));
  if (!lead?.phone) throw new DomainError('common.errors.notFound');
  let householdId = lead.householdId;
  if (!householdId) {
    // A family that already has this phone (opened by the office meanwhile) is the family.
    const [known] = await rows<{ h: string }>(
      tx,
      sql`select household_id h from guardians where phone_e164 = ${lead.phone} limit 1`,
    );
    householdId =
      known?.h ??
      (
        await createHousehold(
          tx,
          ctx,
          HouseholdInput.parse({ displayName: `${p.parentFirstName} ${p.parentLastName}` }),
          GuardianInput.parse({
            firstName: p.parentFirstName,
            lastName: p.parentLastName,
            phoneE164: lead.phone,
            whatsappOptIn: true,
          }),
        )
      ).householdId;
  }
  const studentId = await addStudent(
    tx,
    ctx,
    householdId,
    StudentInput.parse({
      firstName: p.childFirstName,
      lastName: p.parentLastName,
      dob: p.childDob,
      gender: p.childGender ?? null,
      levelId: null,
      preferredStaffId: null,
    }),
  );
  const trialId = await bookTrial(tx, ctx, { studentId, sessionId: p.sessionId });
  return { trialId, householdId, studentId };
}

/** Undo: the trial is cancelled (its seat goes); the family stays, the office decides about it. */
export async function cancelLeadTrial(tx: Tx, ctx: ServiceContext, trialId: string) {
  await cancelTrial(tx, ctx, trialId, 'undone');
}
