/**
 * The monthly billing run (brief §6.7): draft every household's statement for a month, review it against last month
 * with the anomalies flagged, then post it to the ledger. Posting announces `billing.run_posted`; the worker collects
 * (standing order, else a payment link). Seats are charged for the month in advance; private lessons and trials of
 * the month before, in arrears (DECISIONS).
 */
import { BillingPeriod, type AnomalyKind, type BillingLineKind } from '@rswim/contracts';
import { and, asc, desc, eq, inArray, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { listTrials } from '@rswim/domain-enrollment';
import { studentsByIds } from '@rswim/domain-people';
import {
  lessonBookingsBetween,
  lessonDatesOfGroups,
  placesOverlapping,
  type BillablePlace,
} from '@rswim/domain-scheduling';
import { loadPolicyResolver, loadPriceResolver } from '@rswim/domain-settings';
import { agorot } from '@rswim/money';
import {
  addDays,
  applySiblingDiscount,
  billingRulesFrom,
  chargeForSeat,
  chargeForSlots,
  detectAnomalies,
  periodEnd,
  periodStart,
  shiftPeriod,
  statementTotal,
  type Anomaly,
  type DateRange,
  type Explanation,
} from '../policies';
import { postEntry } from './ledger';
import { guarded, todayIL } from './shared';

const {
  billingRunLines,
  billingRuns,
  cancellationRequests,
  enrollmentFreezes,
  households,
  standingOrders,
} = schema;

/** Programs sold as one package (a summer course, a camp week): charged once, in the month the place starts. */
const PACKAGE_PROGRAMS = new Set(['intensive_course', 'camp']);

interface DraftLine {
  key: string;
  householdId: string;
  studentId: string | null;
  enrollmentId: string | null;
  kind: BillingLineKind;
  period: string;
  description: string;
  amountAgorot: number;
  appliesToKey: string | null;
  sessionDates: string[];
  missingPrice: boolean;
  explanation: Explanation;
  policyVersionKey: string | null;
}

export interface RunTotals {
  households: number;
  totalAgorot: number;
  previousTotalAgorot: number;
  anomalies: Partial<Record<AnomalyKind, number>>;
}

/**
 * Drafts (or redrafts) the run of a month. A posted month cannot be drafted again; a draft is replaced, so the owner
 * can fix the data the review flagged and draft again.
 */
export async function draftRun(tx: Tx, ctx: ServiceContext, rawPeriod: string) {
  const period = BillingPeriod.parse(rawPeriod);
  const [existing] = await tx
    .select()
    .from(billingRuns)
    .where(and(eq(billingRuns.period, period), ne(billingRuns.status, 'discarded')));
  if (existing?.status === 'posted') throw new DomainError('billing.errors.alreadyPosted');
  if (existing) await tx.delete(billingRuns).where(eq(billingRuns.id, existing.id));

  const from = periodStart(period);
  const to = periodEnd(period);
  const prev = shiftPeriod(period, -1);
  const [policyAt, priceAt] = await Promise.all([loadPolicyResolver(tx), loadPriceResolver(tx)]);
  const orgRules = billingRulesFrom(policyAt({ date: from }).rules);

  // ─── Seats (in advance) ───────────────────────────────────────────────────
  const places = await placesOverlapping(tx, from, addDays(to, 1));
  const placeIds = places.map((p) => p.enrollmentId);
  const [dates, freezes, cancellations] = await Promise.all([
    lessonDatesOfGroups(tx, [...new Set(places.map((p) => p.classTemplateId))], from, to),
    placeIds.length
      ? tx
          .select()
          .from(enrollmentFreezes)
          .where(
            and(
              inArray(enrollmentFreezes.enrollmentId, placeIds),
              eq(enrollmentFreezes.status, 'approved'),
            ),
          )
      : [],
    placeIds.length
      ? tx
          .select()
          .from(cancellationRequests)
          .where(
            and(
              inArray(cancellationRequests.enrollmentId, placeIds),
              eq(cancellationRequests.status, 'active'),
            ),
          )
      : [],
  ]);

  // ─── Lessons and trials of the month before (in arrears) ──────────────────
  const [bookings, trialRows] = await Promise.all([
    lessonBookingsBetween(tx, periodStart(prev), periodEnd(prev)),
    listTrials(tx, { from: periodStart(prev) }),
  ]);
  const trials = trialRows.filter(
    (t) => t.date <= periodEnd(prev) && (t.feeAgorot ?? 0) > 0 && t.status !== 'no_show',
  );

  const studentIds = [
    ...new Set([
      ...places.map((p) => p.studentId),
      ...bookings.map((b) => b.studentId),
      ...trials.map((t) => t.studentId),
    ]),
  ];
  const students = new Map((await studentsByIds(tx, studentIds)).map((s) => [s.id, s]));
  const householdOf = (studentId: string) => students.get(studentId)?.householdId ?? null;

  const lines: DraftLine[] = [];
  const seats: { householdId: string; enrollmentId: string; studentId: string }[] = [];

  for (const p of places) {
    const householdId = householdOf(p.studentId);
    if (!householdId) continue;
    const policy = policyAt({
      date: from,
      venueId: p.venueId,
      programId: p.programId,
      classTemplateId: p.classTemplateId,
    });
    const rules = billingRulesFrom(policy.rules);
    if (PACKAGE_PROGRAMS.has(p.programKind)) {
      if (p.startsOn < from || p.startsOn > to) continue;
      const price = priceAt({
        date: p.startsOn,
        venueId: p.venueId,
        programId: p.programId,
        kind: 'package',
      });
      seats.push({ householdId, enrollmentId: p.enrollmentId, studentId: p.studentId });
      lines.push({
        ...lineBase(p, householdId, period, policy.versionKey),
        kind: 'package',
        amountAgorot: price?.amount ?? 0,
        missingPrice: !price,
        sessionDates: dates.get(p.classTemplateId) ?? [],
        explanation: {
          code: price ? 'billing.decision.package' : 'billing.decision.noPrice',
          params: {},
        },
      });
      continue;
    }
    const price = priceAt({
      date: from,
      venueId: p.venueId,
      programId: p.programId,
      kind: 'monthly',
      durationMin: p.durationMin,
    });
    const cancellation = cancellations.find((c) => c.enrollmentId === p.enrollmentId);
    const charge = chargeForSeat(
      {
        period,
        price: price ? agorot(price.amount) : null,
        sessionDates: dates.get(p.classTemplateId) ?? [],
        startsOn: p.startsOn,
        endsOn: p.endsOn,
        freezes: freezes
          .filter((f) => f.enrollmentId === p.enrollmentId)
          .map((f): DateRange => ({ from: f.fromDate, to: f.toDate })),
        cancellation: cancellation ? { lastChargedPeriod: cancellation.lastChargedPeriod } : null,
      },
      rules,
    );
    seats.push({ householdId, enrollmentId: p.enrollmentId, studentId: p.studentId });
    lines.push({
      ...lineBase(p, householdId, period, policy.versionKey),
      kind: 'seat',
      amountAgorot: charge.amount,
      missingPrice: charge.missingPrice,
      sessionDates: charge.sessionDates,
      explanation: charge.explanation,
    });
  }

  // Private lessons: one line per child and program for the month before.
  const byChild = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const k = `${b.studentId}:${b.programId ?? ''}`;
    byChild.set(k, [...(byChild.get(k) ?? []), b]);
  }
  for (const group of byChild.values()) {
    const first = group[0] as (typeof bookings)[number];
    const householdId = householdOf(first.studentId);
    if (!householdId) continue;
    const policy = policyAt({
      date: first.date,
      venueId: first.venueId,
      programId: first.programId,
    });
    const charges = chargeForSlots(
      group.map((b) => {
        const price = b.programId
          ? priceAt({
              date: b.date,
              venueId: b.venueId,
              programId: b.programId,
              kind: 'single',
              durationMin: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
            })
          : null;
        return {
          id: b.bookingId,
          date: b.date,
          startsAt: b.startsAt,
          status: b.status === 'cancelled' ? ('cancelled' as const) : ('booked' as const),
          cancelledAt: b.cancelledAt,
          price: price ? agorot(price.amount) : null,
        };
      }),
      billingRulesFrom(policy.rules),
    );
    const charged = charges.filter((c) => c.charged);
    if (charged.length === 0) continue;
    lines.push({
      key: `slots:${first.studentId}:${first.programId ?? ''}`,
      householdId,
      studentId: first.studentId,
      enrollmentId: null,
      kind: 'slots',
      period: prev,
      description: first.programName ?? first.kind,
      amountAgorot: statementTotal(charged),
      appliesToKey: null,
      sessionDates: charged.map((c) => c.date),
      missingPrice: charged.some((c) => c.missingPrice),
      explanation: {
        code: 'billing.decision.slotsMonth',
        params: {
          lessons: charged.length,
          late: charged.filter((c) => c.explanation.code.endsWith('slotLateCancel')).length,
        },
      },
      policyVersionKey: policy.versionKey,
    });
  }

  for (const t of trials) {
    const householdId = householdOf(t.studentId);
    if (!householdId) continue;
    lines.push({
      key: `trial:${t.id}`,
      householdId,
      studentId: t.studentId,
      enrollmentId: null,
      kind: 'trial',
      period: prev,
      description: t.groupName,
      amountAgorot: t.feeAgorot ?? 0,
      appliesToKey: null,
      sessionDates: [t.date],
      missingPrice: false,
      explanation: { code: 'billing.decision.trialFee', params: {} },
      policyVersionKey: null,
    });
  }

  // ─── Sibling discount over the month's seats ──────────────────────────────
  const byHousehold = new Map<string, DraftLine[]>();
  for (const l of lines)
    byHousehold.set(l.householdId, [...(byHousehold.get(l.householdId) ?? []), l]);
  for (const [householdId, hl] of byHousehold) {
    const seatLines = hl.filter((l) => l.kind === 'seat' && l.amountAgorot > 0);
    const childTotals = [...new Set(seatLines.map((l) => l.studentId as string))].map((sid) => ({
      studentId: sid,
      birthDate: students.get(sid)?.dob ?? null,
      amount: agorot(
        seatLines.filter((l) => l.studentId === sid).reduce((s, l) => s + l.amountAgorot, 0),
      ),
    }));
    for (const d of applySiblingDiscount(childTotals, orgRules.sibling)) {
      if (d.discount === 0) continue;
      const main = seatLines
        .filter((l) => l.studentId === d.studentId)
        .sort((a, b) => b.amountAgorot - a.amountAgorot)[0] as DraftLine;
      const s = students.get(d.studentId);
      const line: DraftLine = {
        key: `sibling:${d.studentId}`,
        householdId,
        studentId: d.studentId,
        enrollmentId: null,
        kind: 'sibling_discount',
        period,
        description: s ? s.firstName : '',
        amountAgorot: -d.discount,
        appliesToKey: main.key,
        sessionDates: [],
        missingPrice: false,
        explanation: d.explanation,
        policyVersionKey: null,
      };
      lines.push(line);
      hl.push(line);
    }
  }

  // ─── Review ───────────────────────────────────────────────────────────────
  const mandates = await tx
    .select({ id: standingOrders.id, householdId: standingOrders.householdId })
    .from(standingOrders)
    .where(inArray(standingOrders.status, ['active', 'failing']));
  const previous = await previousTotals(tx, prev);
  const householdIds = new Set([...byHousehold.keys(), ...mandates.map((m) => m.householdId)]);
  const anomalies: Anomaly[] = [];
  for (const householdId of householdIds) {
    anomalies.push(
      ...detectAnomalies(
        {
          householdId,
          seats: seats.filter((s) => s.householdId === householdId),
          lines: (byHousehold.get(householdId) ?? []).map((l) => ({
            kind: l.kind,
            enrollmentId: l.enrollmentId,
            studentId: l.studentId,
            amount: l.amountAgorot,
            missingPrice: l.missingPrice,
          })),
          mandateIds: mandates.filter((m) => m.householdId === householdId).map((m) => m.id),
          previousTotal: previous.get(householdId) ?? null,
        },
        orgRules,
      ),
    );
  }

  const totals: RunTotals = {
    households: byHousehold.size,
    totalAgorot: statementTotal(lines.map((l) => ({ amount: l.amountAgorot }))),
    previousTotalAgorot: [...previous.values()].reduce((s, v) => s + v, 0),
    anomalies: anomalies.reduce<RunTotals['anomalies']>(
      (acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }),
      {},
    ),
  };
  const [run] = await guarded(() =>
    tx
      .insert(billingRuns)
      .values({
        organizationId: ctx.orgId,
        period,
        status: 'draft',
        totals,
        anomalies,
        draftedBy: ctx.userId,
      })
      .returning({ id: billingRuns.id }),
  );
  const runId = (run as { id: string }).id;
  const ids = new Map<string, string>();
  // Lines without a target first, so a discount can point at its seat.
  for (const l of [...lines].sort((a, b) => Number(!!a.appliesToKey) - Number(!!b.appliesToKey))) {
    const [row] = await tx
      .insert(billingRunLines)
      .values({
        organizationId: ctx.orgId,
        billingRunId: runId,
        householdId: l.householdId,
        studentId: l.studentId,
        enrollmentId: l.enrollmentId,
        kind: l.kind,
        period: l.period,
        description: l.description,
        amountAgorot: l.amountAgorot,
        appliesToLineId: l.appliesToKey ? (ids.get(l.appliesToKey) ?? null) : null,
        sessionDates: l.sessionDates,
        missingPrice: l.missingPrice,
        explanation: l.explanation,
        policyVersionKey: l.policyVersionKey,
      })
      .returning({ id: billingRunLines.id });
    ids.set(l.key, (row as { id: string }).id);
  }
  return { runId, totals, anomalies };
}

function lineBase(p: BillablePlace, householdId: string, period: string, versionKey: string) {
  return {
    key: `seat:${p.enrollmentId}`,
    householdId,
    studentId: p.studentId,
    enrollmentId: p.enrollmentId,
    period,
    description: p.groupName,
    appliesToKey: null,
    policyVersionKey: versionKey,
  };
}

/** Each household's total in the posted run of a month. */
async function previousTotals(tx: Tx, period: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      householdId: billingRunLines.householdId,
      total: sql<number>`sum(${billingRunLines.amountAgorot})::int`,
    })
    .from(billingRunLines)
    .innerJoin(billingRuns, eq(billingRuns.id, billingRunLines.billingRunId))
    .where(and(eq(billingRuns.period, period), eq(billingRuns.status, 'posted')))
    .groupBy(billingRunLines.householdId);
  return new Map(rows.map((r) => [r.householdId, r.total]));
}

export async function listRuns(tx: Tx) {
  return tx
    .select()
    .from(billingRuns)
    .orderBy(desc(billingRuns.period), desc(billingRuns.draftedAt));
}

/** A run with its lines grouped per household, last month's totals and the anomalies (the review screen). */
export async function getRun(tx: Tx, runId: string) {
  const [run] = await tx.select().from(billingRuns).where(eq(billingRuns.id, runId));
  if (!run) return null;
  const lines = await tx
    .select()
    .from(billingRunLines)
    .where(eq(billingRunLines.billingRunId, runId))
    .orderBy(asc(billingRunLines.createdAt));
  const anomalies = run.anomalies as Anomaly[];
  const householdIds = [
    ...new Set([...lines.map((l) => l.householdId), ...anomalies.map((a) => a.householdId)]),
  ];
  const [names, previous, studentRows] = await Promise.all([
    householdIds.length
      ? tx
          .select({ id: households.id, name: households.displayName })
          .from(households)
          .where(inArray(households.id, householdIds))
      : [],
    previousTotals(tx, shiftPeriod(run.period, -1)),
    studentsByIds(tx, [...new Set(lines.map((l) => l.studentId).filter((x): x is string => !!x))]),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const studentName = new Map(studentRows.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  const families = householdIds
    .map((id) => {
      const hl = lines.filter((l) => l.householdId === id);
      const total = hl.reduce((s, l) => s + l.amountAgorot, 0);
      return {
        householdId: id,
        name: nameOf.get(id) ?? '',
        lines: hl.map((l) => ({
          ...l,
          studentName: l.studentId ? (studentName.get(l.studentId) ?? '') : '',
        })),
        total,
        previousTotal: previous.get(id) ?? null,
        anomalies: anomalies.filter((a) => a.householdId === id),
      };
    })
    .sort((a, b) => b.anomalies.length - a.anomalies.length || a.name.localeCompare(b.name, 'he'));
  return { run, families, totals: run.totals as RunTotals, anomalies };
}

export async function discardRun(tx: Tx, runId: string) {
  const [run] = await tx.select().from(billingRuns).where(eq(billingRuns.id, runId));
  if (!run) throw new DomainError('common.errors.notFound');
  await guarded(() =>
    tx.update(billingRuns).set({ status: 'discarded' }).where(eq(billingRuns.id, runId)),
  );
}

/**
 * Approves a draft: every non-zero line becomes a ledger entry (charges positive, discounts negative) and the run is
 * posted. The worker then collects each household's part.
 */
export async function postRun(tx: Tx, ctx: ServiceContext, runId: string) {
  const [run] = await tx.select().from(billingRuns).where(eq(billingRuns.id, runId)).for('update');
  if (!run) throw new DomainError('common.errors.notFound');
  if (run.status !== 'draft') throw new DomainError('billing.errors.runLocked');
  const lines = await tx
    .select()
    .from(billingRunLines)
    .where(eq(billingRunLines.billingRunId, runId));
  const today = await todayIL(tx);
  for (const l of lines) {
    if (l.amountAgorot === 0) continue;
    await postEntry(tx, ctx, {
      householdId: l.householdId,
      studentId: l.studentId,
      enrollmentId: l.enrollmentId,
      type: l.kind === 'sibling_discount' ? 'discount' : 'charge',
      amountAgorot: l.amountAgorot,
      description: l.description,
      period: l.period,
      occurredOn: today,
      source: 'billing_run',
      billingRunId: runId,
      billingRunLineId: l.id,
      policyVersionKey: l.policyVersionKey,
      explanation: l.explanation,
      idempotencyKey: `run-line:${l.id}`,
    });
  }
  await guarded(() =>
    tx
      .update(billingRuns)
      .set({ status: 'posted', postedAt: new Date(), postedBy: ctx.userId })
      .where(eq(billingRuns.id, runId)),
  );
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'billing.run_posted',
    payload: { runId, period: run.period },
    idempotencyKey: `billing.run_posted:${runId}`,
  });
  return { posted: lines.filter((l) => l.amountAgorot !== 0).length };
}

/** Each household's part of a posted run: what the worker collects. */
export async function runTotalsByHousehold(tx: Tx, runId: string) {
  return tx
    .select({
      householdId: billingRunLines.householdId,
      total: sql<number>`sum(${billingRunLines.amountAgorot})::int`,
    })
    .from(billingRunLines)
    .where(eq(billingRunLines.billingRunId, runId))
    .groupBy(billingRunLines.householdId);
}
