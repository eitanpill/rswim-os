/**
 * The monthly payroll run (brief §6.8). A draft prices every lesson each instructor taught that month with their pay
 * rules, adds travel and the month's adjustments, and splits each instructor's pay into the payslip part and the
 * transfer part. Drafting again replaces the draft. Approving locks it (database trigger), accrues sick leave and emits
 * `payroll.run_approved`; the accountant exports it and each instructor sees their own statement.
 */
import { z } from 'zod';
import {
  AdjustmentKind,
  BillingPeriod,
  PayRouting,
  requiredDate,
  requiredText,
  type EmploymentType,
  type PayBasis,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { lessonsTaught, type TaughtLesson } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { listStaff, payRulesOf } from '@rswim/domain-staff';
import { parseShekels } from '@rswim/money';
import {
  computeStaffPay,
  payrollRulesFrom,
  pensionStatus,
  periodBounds,
  sickAccrual,
  type AdjustmentRow,
  type PayRuleRow,
  type PensionStatus,
  type StaffPay,
  type WorkItem,
} from '../policies';

const { payrollAdjustments, payrollLines, payrollRuns, sickLeaveEntries, timesheets } = schema;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

export const toWorkItem = (l: TaughtLesson): WorkItem => ({
  workKind: l.workKind,
  sessionId: l.sessionId,
  slotId: l.slotId,
  date: l.date,
  venueId: l.venueId,
  programId: l.programId,
  minutes: l.minutes,
  heads: l.heads,
  label: `${l.name} · ${l.time}`,
});

export const toRuleRow = (r: Awaited<ReturnType<typeof payRulesOf>>[number]): PayRuleRow => ({
  id: r.id,
  basis: r.basis as PayBasis,
  amountAgorot: r.amountAgorot,
  programId: r.programId,
  venueId: r.venueId,
  routing: r.routing as PayRouting,
  travelAllowanceAgorot: r.travelAllowanceAgorot,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

async function adjustmentsOf(
  tx: Tx,
  period: string,
  staffId?: string,
): Promise<(AdjustmentRow & { staffMemberId: string })[]> {
  const rows = await tx
    .select()
    .from(payrollAdjustments)
    .where(
      and(
        eq(payrollAdjustments.period, period),
        staffId ? eq(payrollAdjustments.staffMemberId, staffId) : undefined,
      ),
    )
    .orderBy(asc(payrollAdjustments.createdAt));
  return rows.map((a) => ({
    id: a.id,
    staffMemberId: a.staffMemberId,
    kind: a.kind,
    routing: a.routing as PayRouting,
    amountAgorot: a.amountAgorot,
    note: a.note,
  }));
}

/** One instructor's month as payroll sees it now: the lessons, what they pay, and their timesheet. */
export async function staffMonth(tx: Tx, period: string, staffId: string) {
  const { from, to } = periodBounds(BillingPeriod.parse(period));
  const [lessons, rules, adjustments, [sheet]] = await Promise.all([
    lessonsTaught(tx, { from, to, staffId }),
    payRulesOf(tx, [staffId]),
    adjustmentsOf(tx, period, staffId),
    tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.staffMemberId, staffId), eq(timesheets.period, period))),
  ]);
  const pay = computeStaffPay(lessons.map(toWorkItem), rules.map(toRuleRow), adjustments);
  const minutes = lessons.reduce((s, l) => s + l.minutes, 0);
  return { period, lessons, minutes, pay, timesheet: sheet ?? null };
}

/** Months (before `period`) in which an approved run paid this instructor payslip work. */
async function payslipMonths(tx: Tx, staffIds: readonly string[], period: string) {
  if (staffIds.length === 0) return new Map<string, string[]>();
  const r = await tx.execute<{ staff: string; period: string }>(sql`
    select distinct l.staff_member_id as staff, r.period from payroll_lines l
    join payroll_runs r on r.id = l.run_id
    where r.status = 'approved' and r.period < ${period} and l.kind = 'work' and l.routing = 'payslip'
      and l.staff_member_id in (${sql.join(
        staffIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
  const out = new Map<string, string[]>();
  for (const row of r.rows) out.set(row.staff, [...(out.get(row.staff) ?? []), row.period]);
  return out;
}

export interface StaffTotals {
  name: string;
  employmentType: EmploymentType;
  payslip: number;
  transfer: number;
  lessons: number;
  minutes: number;
  unpriced: number;
  timesheet: string;
  pension: PensionStatus;
}

export interface RunTotals {
  payslip: number;
  transfer: number;
  staff: Record<string, StaffTotals>;
}

/**
 * Drafts (or redrafts) the month: every active instructor with lessons or adjustments gets their lines. An approved
 * month cannot be drafted again; corrections go into the next month as adjustments.
 */
export async function draftPayrollRun(tx: Tx, ctx: ServiceContext, period: string) {
  BillingPeriod.parse(period);
  const [existing] = await tx
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.period, period))
    .for('update');
  if (existing?.status === 'approved') throw new DomainError('payroll.errors.runLocked');
  const { from, to } = periodBounds(period);
  const resolved = await resolvePolicyFor(tx, { date: to });
  const rules = payrollRulesFrom(resolved.rules);
  const [staff, lessons, payRules, adjustments, sheets] = await Promise.all([
    listStaff(tx),
    lessonsTaught(tx, { from, to }),
    payRulesOf(tx),
    adjustmentsOf(tx, period),
    tx.select().from(timesheets).where(eq(timesheets.period, period)),
  ]);
  const runId = await guarded(async () => {
    if (existing) {
      await tx.delete(payrollLines).where(eq(payrollLines.runId, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(payrollRuns)
      .values({ organizationId: ctx.orgId, period, draftedBy: ctx.userId })
      .returning({ id: payrollRuns.id });
    return (row as { id: string }).id;
  });

  const involved = staff.filter(
    (s) =>
      lessons.some((l) => l.staffId === s.id) || adjustments.some((a) => a.staffMemberId === s.id),
  );
  const history = await payslipMonths(
    tx,
    involved.map((s) => s.id),
    period,
  );
  const totals: RunTotals = { payslip: 0, transfer: 0, staff: {} };
  const pays = new Map<string, StaffPay>();
  for (const s of involved) {
    const mine = lessons.filter((l) => l.staffId === s.id);
    const pay = computeStaffPay(
      mine.map(toWorkItem),
      payRules.filter((r) => r.staffMemberId === s.id).map(toRuleRow),
      adjustments.filter((a) => a.staffMemberId === s.id),
    );
    pays.set(s.id, pay);
    const workedOnPayslip = pay.lines.some((l) => l.kind === 'work' && l.routing === 'payslip');
    const months = [...(history.get(s.id) ?? []), ...(workedOnPayslip ? [period] : [])];
    totals.staff[s.id] = {
      name: `${s.firstName} ${s.lastName}`,
      employmentType: s.employmentType as EmploymentType,
      payslip: pay.payslip,
      transfer: pay.transfer,
      lessons: mine.length,
      minutes: mine.reduce((m, l) => m + l.minutes, 0),
      unpriced: pay.unpriced.length,
      timesheet: sheets.find((t) => t.staffMemberId === s.id)?.status ?? 'open',
      pension: pensionStatus(months, period, rules.pensionThresholdMonths),
    };
    totals.payslip += pay.payslip;
    totals.transfer += pay.transfer;
    if (pay.lines.length > 0) {
      await guarded(() =>
        tx.insert(payrollLines).values(
          pay.lines.map((l) => ({
            organizationId: ctx.orgId,
            runId,
            period,
            staffMemberId: s.id,
            routing: l.routing,
            kind: l.kind,
            workKind: l.workKind,
            date: l.date,
            description: l.description,
            quantity: String(l.quantity),
            unit: l.unit,
            amountAgorot: l.amount,
            payRuleId: l.payRuleId,
            sessionId: l.sessionId,
            slotId: l.slotId,
            adjustmentId: l.adjustmentId,
            explanation: l.explanation,
          })),
        ),
      );
    }
  }
  await tx
    .update(payrollRuns)
    .set({ totals, policyVersionKey: resolved.versionKey, draftedBy: ctx.userId })
    .where(eq(payrollRuns.id, runId));
  return { runId, totals, pays };
}

/**
 * Approves a draft. Open disputes must be resolved first. Approving locks the lines, accrues the month's sick leave
 * and tells the worker (payslip statements become visible to each instructor).
 */
export async function approvePayrollRun(tx: Tx, ctx: ServiceContext, runId: string) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for('update');
  if (!run) throw new DomainError('common.errors.notFound');
  if (run.status !== 'draft') throw new DomainError('payroll.errors.runLocked');
  const disputed = await tx
    .select({ id: timesheets.id })
    .from(timesheets)
    .where(and(eq(timesheets.period, run.period), eq(timesheets.status, 'disputed')));
  if (disputed.length > 0)
    throw new DomainError('payroll.errors.disputesOpen', { count: disputed.length });

  const totals = run.totals as RunTotals;
  const resolved = await resolvePolicyFor(tx, { date: periodBounds(run.period).to });
  const rules = payrollRulesFrom(resolved.rules);
  const payslipStaff = await tx
    .selectDistinct({ id: payrollLines.staffMemberId })
    .from(payrollLines)
    .where(
      and(
        eq(payrollLines.runId, runId),
        eq(payrollLines.kind, 'work'),
        eq(payrollLines.routing, 'payslip'),
      ),
    );
  const onPayslip = new Set(payslipStaff.map((r) => r.id));
  for (const [staffId, t] of Object.entries(totals.staff ?? {})) {
    const halfDays = sickAccrual(t.employmentType, onPayslip.has(staffId), rules);
    if (halfDays > 0) {
      await tx
        .insert(sickLeaveEntries)
        .values({
          organizationId: ctx.orgId,
          staffMemberId: staffId,
          kind: 'accrual',
          period: run.period,
          halfDays,
          runId,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
    }
  }
  await guarded(() =>
    tx
      .update(payrollRuns)
      .set({ status: 'approved', approvedAt: new Date(), approvedBy: ctx.userId })
      .where(eq(payrollRuns.id, runId)),
  );
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'payroll.run_approved',
    payload: {
      runId,
      period: run.period,
      payslipAgorot: totals.payslip,
      transferAgorot: totals.transfer,
    },
    idempotencyKey: `payroll.run_approved:${runId}`,
  });
}

export async function listPayrollRuns(tx: Tx) {
  return tx.select().from(payrollRuns).orderBy(desc(payrollRuns.period));
}

export type RunLine = typeof payrollLines.$inferSelect;

/** A run with its lines grouped by instructor (payslip lines first). */
export async function getPayrollRun(tx: Tx, runId: string) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return null;
  const lines = await tx
    .select()
    .from(payrollLines)
    .where(eq(payrollLines.runId, runId))
    .orderBy(asc(payrollLines.routing), asc(payrollLines.date), asc(payrollLines.kind));
  const totals = run.totals as RunTotals;
  const staff = Object.entries(totals.staff ?? {})
    .map(([id, t]) => ({ id, ...t, lines: lines.filter((l) => l.staffMemberId === id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { run, totals, staff };
}

export async function getPayrollRunByPeriod(tx: Tx, period: string) {
  const [run] = await tx
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(eq(payrollRuns.period, period));
  return run ? getPayrollRun(tx, run.id) : null;
}

// ─── Adjustments and sick days ──────────────────────────────────────────────

export const AdjustmentInput = z.object({
  staffMemberId: z.uuid(),
  period: BillingPeriod,
  kind: AdjustmentKind,
  routing: PayRouting,
  // Shekels as typed ("-67.50"), or agorot already parsed (the web form validates before the service re-parses).
  amount: z.union([
    z
      .number()
      .int()
      .refine((n) => n !== 0, 'forms.errors.amount'),
    z
      .string()
      .trim()
      .transform((v, c) => {
        const negative = v.startsWith('-');
        const parsed = parseShekels(negative ? v.slice(1) : v);
        if (parsed === null || parsed === 0) {
          c.addIssue({ code: 'custom', message: 'forms.errors.amount' });
          return z.NEVER;
        }
        return negative ? -parsed : parsed;
      }),
  ]),
  note: requiredText(200),
});
export type AdjustmentInput = z.input<typeof AdjustmentInput>;

export async function addAdjustment(tx: Tx, ctx: ServiceContext, raw: AdjustmentInput) {
  const input = AdjustmentInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(payrollAdjustments)
      .values({
        organizationId: ctx.orgId,
        staffMemberId: input.staffMemberId,
        period: input.period,
        kind: input.kind,
        routing: input.routing,
        amountAgorot: input.amount,
        note: input.note,
        createdBy: ctx.userId,
      })
      .returning({ id: payrollAdjustments.id }),
  );
  return (row as { id: string }).id;
}

export async function deleteAdjustment(tx: Tx, id: string) {
  await guarded(() => tx.delete(payrollAdjustments).where(eq(payrollAdjustments.id, id)));
}

export async function listAdjustments(tx: Tx, period: string) {
  return tx
    .select()
    .from(payrollAdjustments)
    .where(eq(payrollAdjustments.period, period))
    .orderBy(asc(payrollAdjustments.createdAt));
}

export const SickDayInput = z.object({
  staffMemberId: z.uuid(),
  date: requiredDate(),
  halfDays: z.coerce.number().int().min(1).max(20),
  note: z.string().trim().max(200).optional(),
});
export type SickDayInput = z.input<typeof SickDayInput>;

/** Records sick leave taken (in half days); the balance may go negative and the owner sees it. */
export async function recordSickDay(tx: Tx, ctx: ServiceContext, raw: SickDayInput) {
  const input = SickDayInput.parse(raw);
  await tx.insert(sickLeaveEntries).values({
    organizationId: ctx.orgId,
    staffMemberId: input.staffMemberId,
    kind: 'taken',
    period: input.date.slice(0, 7),
    date: input.date,
    halfDays: -input.halfDays,
    note: input.note || null,
    createdBy: ctx.userId,
  });
}

/** Sick-leave balance in half days per instructor (RLS limits an instructor to their own). */
export async function sickBalances(
  tx: Tx,
  staffIds?: readonly string[],
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      staff: sickLeaveEntries.staffMemberId,
      n: sql<number>`sum(${sickLeaveEntries.halfDays})::int`,
    })
    .from(sickLeaveEntries)
    .where(staffIds ? inArray(sickLeaveEntries.staffMemberId, [...staffIds]) : undefined)
    .groupBy(sickLeaveEntries.staffMemberId);
  return new Map(rows.map((r) => [r.staff, r.n]));
}

export async function sickEntries(tx: Tx, staffId: string) {
  return tx
    .select()
    .from(sickLeaveEntries)
    .where(eq(sickLeaveEntries.staffMemberId, staffId))
    .orderBy(desc(sickLeaveEntries.createdAt));
}

// ─── An instructor's own statements ─────────────────────────────────────────

/** The approved months an instructor can see, with their own lines (RLS: own lines of approved runs only). */
export async function myStatements(tx: Tx, staffId: string) {
  const lines = await tx
    .select()
    .from(payrollLines)
    .where(eq(payrollLines.staffMemberId, staffId))
    .orderBy(asc(payrollLines.kind), asc(payrollLines.date));
  const periods = [...new Set(lines.map((l) => l.period))].sort().reverse();
  return periods.map((period) => {
    const mine = lines.filter((l) => l.period === period);
    const sum = (routing: string) =>
      mine.filter((l) => l.routing === routing).reduce((s, l) => s + l.amountAgorot, 0);
    return { period, lines: mine, payslip: sum('payslip'), transfer: sum('transfer') };
  });
}
