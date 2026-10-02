/**
 * Absence notices and the makeup credit ledger (brief §6.4). The office records a notice and sees the decision at
 * once; a family's notice is received now and classified by the worker, so a parent never decides their own credit.
 */
import { z } from 'zod';
import {
  ABSENCE_CHANNELS,
  optionalText,
  requiredDate,
  requiredText,
  type CreditStatus,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, lt, ne, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { seatHoldersOn } from '@rswim/domain-scheduling';
import {
  canEarnMakeup,
  classifyAbsenceNotice,
  makeupExpiry,
  monthOf,
  type Explanation,
} from '../policies';
import { isOffice, rulesForSession, sessionOrThrow, todayIL } from './shared';

const { absenceNotices, makeupCredits } = schema;

/** "YYYY-MM-DDTHH:MM" as typed in Israel (datetime-local), or empty for "now". */
const localDateTime = z
  .preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'forms.errors.dateTime')
      .optional(),
  )
  .transform((v) => v ?? null);

export const AbsenceInput = z.object({
  sessionId: z.uuid(),
  studentId: z.uuid(),
  channel: z.enum(ABSENCE_CHANNELS).default('parent_portal'),
  receivedAt: localDateTime,
  note: optionalText(500),
});
export type AbsenceInput = z.input<typeof AbsenceInput>;

export interface AbsenceOutcome {
  noticeId: string;
  status: 'pending' | 'processed';
  classification: 'timely' | 'late_notice' | null;
  creditId: string | null;
  notice: Explanation | null;
  credit: Explanation | null;
}

/**
 * Records a notice for a lesson of a group the child holds a seat in. The office's notices are classified in the same
 * transaction; a family's wait for the worker (`attendance.absence_reported`).
 */
export async function reportAbsence(
  tx: Tx,
  ctx: ServiceContext,
  raw: AbsenceInput,
): Promise<AbsenceOutcome> {
  const input = AbsenceInput.parse(raw);
  const s = await sessionOrThrow(tx, input.sessionId);
  if (s.status !== 'scheduled') throw new DomainError('attendance.errors.sessionNotScheduled');
  const seats = await seatHoldersOn(tx, [s.classTemplateId], s.date);
  if (!seats.some((e) => e.studentId === input.studentId)) {
    throw new DomainError('attendance.errors.notInSession');
  }
  const office = await isOffice(tx);
  const receivedAt =
    office && input.receivedAt
      ? sql`(${input.receivedAt}::timestamp at time zone 'Asia/Jerusalem')`
      : sql`now()`;
  const [row] = await tx
    .insert(absenceNotices)
    .values({
      organizationId: ctx.orgId,
      sessionId: s.id,
      studentId: input.studentId,
      channel: office ? input.channel : 'parent_portal',
      receivedAt,
      note: input.note,
      reportedBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning({ id: absenceNotices.id });
  if (!row) throw new DomainError('attendance.errors.alreadyReported');
  if (office) return processAbsenceNotice(tx, ctx, row.id);
  // A parent may not read the outbox back, so the event carries everything the worker needs.
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.absence_reported',
    payload: { noticeId: row.id, sessionId: s.id, studentId: input.studentId },
    idempotencyKey: `attendance.absence_reported:${row.id}`,
  });
  return {
    noticeId: row.id,
    status: 'pending',
    classification: null,
    creditId: null,
    notice: null,
    credit: null,
  };
}

/** Credits in the lesson's month that count toward `makeup.max_per_month`. */
async function creditsInMonth(tx: Tx, studentId: string, date: string): Promise<number> {
  const r = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from makeup_credits
    where student_id = ${studentId} and counts_toward_cap and status <> 'void'
      and to_char(source_date, 'YYYY-MM') = ${monthOf(date)}`);
  return (r.rows[0] as { n: number }).n;
}

/**
 * Classifies a pending notice against the regulations in force for its lesson and issues the credit it earns, with
 * the policy version that decided. Processing a notice twice changes nothing.
 */
export async function processAbsenceNotice(
  tx: Tx,
  ctx: ServiceContext,
  noticeId: string,
): Promise<AbsenceOutcome> {
  const [n] = await tx.select().from(absenceNotices).where(eq(absenceNotices.id, noticeId));
  if (!n) throw new DomainError('common.errors.notFound');
  if (n.status !== 'pending') {
    const d = (n.decision ?? null) as { notice: Explanation; credit: Explanation } | null;
    return {
      noticeId,
      status: 'processed',
      classification: n.classification as AbsenceOutcome['classification'],
      creditId: n.creditId,
      notice: d?.notice ?? null,
      credit: d?.credit ?? null,
    };
  }
  const s = await sessionOrThrow(tx, n.sessionId);
  const { rules, versionKey } = await rulesForSession(tx, s);
  // One child's notices are decided one at a time, so two at once cannot both pass the monthly cap.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`makeup-cap:${n.studentId}`}))`);
  const notice = classifyAbsenceNotice({ receivedAt: n.receivedAt, startsAt: s.startsAt }, rules);
  const earn = canEarnMakeup(
    {
      classification: notice.classification,
      creditsThisMonth: await creditsInMonth(tx, n.studentId, s.date),
    },
    rules,
  );
  let creditId: string | null = null;
  if (earn.earns) {
    const today = await todayIL(tx);
    const expiresOn = makeupExpiry(s.date, rules.expiry);
    const [c] = await tx
      .insert(makeupCredits)
      .values({
        organizationId: ctx.orgId,
        studentId: n.studentId,
        programId: s.programId,
        reason: 'notified_absence',
        sourceSessionId: s.id,
        sourceDate: s.date,
        issuedOn: today < expiresOn ? today : expiresOn,
        expiresOn,
        policyVersionKey: versionKey,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: makeupCredits.id });
    creditId = c?.id ?? null;
  }
  await tx
    .update(absenceNotices)
    .set({
      status: 'processed',
      minutesBefore: notice.minutesBefore,
      classification: notice.classification,
      decision: { notice: notice.explanation, credit: earn.explanation },
      policyVersionKey: versionKey,
      creditId,
      processedAt: sql`now()`,
    })
    .where(eq(absenceNotices.id, noticeId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.absence_processed',
    payload: {
      noticeId,
      studentId: n.studentId,
      sessionId: s.id,
      classification: notice.classification,
      creditId,
    },
    idempotencyKey: `attendance.absence_processed:${noticeId}`,
  });
  return {
    noticeId,
    status: 'processed',
    classification: notice.classification,
    creditId,
    notice: notice.explanation,
    credit: earn.explanation,
  };
}

/** Notices still waiting (the worker's safety net if an event was lost). */
export async function processPendingNotices(tx: Tx, ctx: ServiceContext): Promise<number> {
  const rows = await tx
    .select({ id: absenceNotices.id })
    .from(absenceNotices)
    .where(eq(absenceNotices.status, 'pending'))
    .orderBy(asc(absenceNotices.receivedAt));
  for (const r of rows) await processAbsenceNotice(tx, ctx, r.id);
  return rows.length;
}

export async function withdrawNotice(tx: Tx, ctx: ServiceContext, noticeId: string) {
  const [n] = await tx
    .update(absenceNotices)
    .set({ status: 'withdrawn' })
    .where(and(eq(absenceNotices.id, noticeId), ne(absenceNotices.status, 'withdrawn')))
    .returning();
  if (!n) throw new DomainError('common.errors.notFound');
  if (n.creditId) {
    await tx
      .update(makeupCredits)
      .set({ status: 'void', note: 'notice withdrawn' })
      .where(and(eq(makeupCredits.id, n.creditId), eq(makeupCredits.status, 'open')));
  }
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.absence_withdrawn',
    payload: { noticeId, studentId: n.studentId, sessionId: n.sessionId },
    idempotencyKey: `attendance.absence_withdrawn:${noticeId}`,
  });
}

/** Notices for some sessions or some children, newest first. */
export async function listNotices(
  tx: Tx,
  filter: { sessionIds?: readonly string[]; studentIds?: readonly string[]; limit?: number },
) {
  return tx
    .select()
    .from(absenceNotices)
    .where(
      and(
        filter.sessionIds ? inArray(absenceNotices.sessionId, [...filter.sessionIds]) : undefined,
        filter.studentIds ? inArray(absenceNotices.studentId, [...filter.studentIds]) : undefined,
      ),
    )
    .orderBy(desc(absenceNotices.receivedAt))
    .limit(filter.limit ?? 200);
}

// ─── Credits ────────────────────────────────────────────────────────────────

export type CreditRow = typeof makeupCredits.$inferSelect;

export async function listCredits(
  tx: Tx,
  filter: {
    studentIds?: readonly string[];
    statuses?: readonly CreditStatus[];
    closureEventId?: string;
    limit?: number;
  } = {},
): Promise<CreditRow[]> {
  return tx
    .select()
    .from(makeupCredits)
    .where(
      and(
        filter.studentIds ? inArray(makeupCredits.studentId, [...filter.studentIds]) : undefined,
        filter.statuses ? inArray(makeupCredits.status, [...filter.statuses]) : undefined,
        filter.closureEventId ? eq(makeupCredits.closureEventId, filter.closureEventId) : undefined,
      ),
    )
    .orderBy(asc(makeupCredits.expiresOn), asc(makeupCredits.createdAt))
    .limit(filter.limit ?? 500);
}

export const GoodwillInput = z.object({
  studentId: z.uuid(),
  programId: z.uuid(),
  expiresOn: requiredDate(),
  note: requiredText(300),
});

/** A credit the owner grants outside the rules (it does not count toward the monthly cap). */
export async function issueGoodwillCredit(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof GoodwillInput>,
): Promise<string> {
  const input = GoodwillInput.parse(raw);
  const today = await todayIL(tx);
  if (input.expiresOn < today) throw new DomainError('attendance.errors.expiryPast');
  const [c] = await tx
    .insert(makeupCredits)
    .values({
      organizationId: ctx.orgId,
      studentId: input.studentId,
      programId: input.programId,
      reason: 'goodwill',
      issuedOn: today,
      expiresOn: input.expiresOn,
      countsTowardCap: false,
      note: input.note,
      createdBy: ctx.userId,
    })
    .returning({ id: makeupCredits.id });
  const id = (c as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.credit_issued',
    payload: { creditId: id, studentId: input.studentId, reason: 'goodwill' },
    idempotencyKey: `attendance.credit_issued:${id}`,
  });
  return id;
}

export async function voidCredit(tx: Tx, ctx: ServiceContext, creditId: string, note: string) {
  const rows = await tx
    .update(makeupCredits)
    .set({ status: 'void', note })
    .where(and(eq(makeupCredits.id, creditId), eq(makeupCredits.status, 'open')))
    .returning({ id: makeupCredits.id });
  if (rows.length === 0) throw new DomainError('attendance.errors.creditNotOpen');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'attendance.credit_voided',
    payload: { creditId },
    idempotencyKey: `attendance.credit_voided:${creditId}`,
  });
}

/** Daily: open credits past their last day expire (no carry-over). */
export async function expireDueCredits(tx: Tx, ctx: ServiceContext): Promise<number> {
  const today = await todayIL(tx);
  const rows = await tx
    .update(makeupCredits)
    .set({ status: 'expired' })
    .where(and(eq(makeupCredits.status, 'open'), lt(makeupCredits.expiresOn, today)))
    .returning({ id: makeupCredits.id });
  if (rows.length > 0) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'attendance.credits_expired',
      payload: { creditIds: rows.map((r) => r.id), on: today },
      idempotencyKey: `attendance.credits_expired:${today}:${(rows[0] as { id: string }).id}`,
    });
  }
  return rows.length;
}
