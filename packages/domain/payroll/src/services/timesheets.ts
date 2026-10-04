/**
 * Month-end hours (brief §6.8): no free-text reports. The instructor sees the lessons they taught, then confirms the
 * month or disputes it with a note; the owner resolves a dispute, adding an adjustment when the lessons were wrong.
 * Approving a month's payroll needs every dispute resolved.
 */
import { z } from 'zod';
import { BillingPeriod, optionalText, requiredText } from '@rswim/contracts';
import { and, eq, schema, type Tx } from '@rswim/db';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { listStaff } from '@rswim/domain-staff';
import { addAdjustment, staffMonth, type AdjustmentInput } from './runs';

const { timesheets } = schema;

export const TimesheetAnswer = z
  .object({
    period: BillingPeriod,
    confirm: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
    note: optionalText(500),
  })
  .refine((v) => v.confirm || !!v.note, { path: ['note'], message: 'payroll.errors.disputeNote' });
export type TimesheetAnswer = z.input<typeof TimesheetAnswer>;

/** The instructor confirms or disputes their own month (the database refuses anyone else's, or a paid month). */
export async function answerTimesheet(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  raw: TimesheetAnswer,
) {
  const input = TimesheetAnswer.parse(raw);
  const month = await staffMonth(tx, input.period, staffId);
  const values = {
    status: input.confirm ? 'confirmed' : 'disputed',
    snapshot: { lessons: month.lessons.length, minutes: month.minutes },
    disputeNote: input.confirm ? null : input.note,
  };
  try {
    await tx
      .insert(timesheets)
      .values({
        organizationId: ctx.orgId,
        staffMemberId: staffId,
        period: input.period,
        ...values,
      })
      .onConflictDoUpdate({
        target: [timesheets.organizationId, timesheets.staffMemberId, timesheets.period],
        set: values,
      });
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
  return values.status;
}

export const ResolveInput = z.object({
  id: z.uuid(),
  resolution: requiredText(500),
  amount: z.string().trim().optional(),
  routing: z.enum(['payslip', 'transfer']).default('payslip'),
});
export type ResolveInput = z.input<typeof ResolveInput>;

/** The owner closes a dispute, optionally with a correction for that month. */
export async function resolveTimesheet(tx: Tx, ctx: ServiceContext, raw: ResolveInput) {
  const input = ResolveInput.parse(raw);
  const [sheet] = await tx
    .select()
    .from(timesheets)
    .where(eq(timesheets.id, input.id))
    .for('update');
  if (!sheet) throw new DomainError('common.errors.notFound');
  if (sheet.status !== 'disputed') throw new DomainError('payroll.errors.notDisputed');
  if (input.amount) {
    const adj: AdjustmentInput = {
      staffMemberId: sheet.staffMemberId,
      period: sheet.period,
      kind: 'correction',
      routing: input.routing,
      amount: input.amount,
      note: input.resolution,
    };
    await addAdjustment(tx, ctx, adj);
  }
  await tx
    .update(timesheets)
    .set({
      status: 'resolved',
      resolution: input.resolution,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    })
    .where(eq(timesheets.id, sheet.id));
}

/** Every instructor's month for the owner: lessons, minutes and timesheet status. */
export async function listTimesheets(tx: Tx, period: string) {
  const [staff, sheets] = await Promise.all([
    listStaff(tx),
    tx
      .select()
      .from(timesheets)
      .where(eq(timesheets.period, BillingPeriod.parse(period))),
  ]);
  const months = await Promise.all(
    staff
      .filter((s) => s.status === 'active')
      .map(async (s) => ({ staff: s, month: await staffMonth(tx, period, s.id) })),
  );
  return months
    .filter(
      ({ staff, month }) =>
        month.lessons.length > 0 || sheets.some((t) => t.staffMemberId === staff.id),
    )
    .map(({ staff, month }) => ({
      staffId: staff.id,
      name: `${staff.firstName} ${staff.lastName}`,
      lessons: month.lessons.length,
      minutes: month.minutes,
      timesheet: sheets.find((t) => t.staffMemberId === staff.id) ?? null,
    }));
}

export async function timesheetOf(tx: Tx, staffId: string, period: string) {
  const [sheet] = await tx
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.staffMemberId, staffId), eq(timesheets.period, period)));
  return sheet ?? null;
}
