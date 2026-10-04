/**
 * The substitute finder (brief §6.8, Phase 6 AC 2). When an instructor cannot teach a lesson, the office opens a
 * request: every other active instructor is checked against the lesson (certificate, gender, skills, availability,
 * travel, another lesson at the same time), the qualified ones are ranked and offered in waves. The first to accept
 * gets it: the database locks the request and withdraws the other offers (`guard_substitute_offer`). The worker then
 * puts the substitute on the lesson and emits `scheduling.staff_changed`, which tells the parents (Phase 5).
 */
import { z } from 'zod';
import { optionalText } from '@rswim/contracts';
import { and, asc, desc, eq, inArray, lte, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { listStaff } from '@rswim/domain-staff';
import {
  checkInstructor,
  rankSubstitutes,
  staffingGaps,
  substituteExclusion,
  toMinutes,
  windowFor,
  type SubstituteCandidate,
  type TemplateDraft,
} from '../policies';
import { activeTemplates, instructorFacts, poolWindows, rulesFor, todayIL } from './shared';
import { setLead } from './shifts';

const {
  certifications,
  classTemplateLanes,
  classTemplates,
  sessions,
  substituteOffers,
  substituteRequests,
} = schema;

export const SubstituteRequestInput = z.object({
  sessionId: z.uuid(),
  reason: optionalText(300),
});
export type SubstituteRequestInput = z.input<typeof SubstituteRequestInput>;

async function lessonOf(tx: Tx, sessionId: string) {
  const r = await tx.execute<{
    id: string;
    date: string;
    status: string;
    starts: string;
    ends: string;
    weekday: number;
    venueId: string;
    venueName: string;
    classTemplateId: string;
    groupName: string;
    leadStaffId: string | null;
  }>(sql`
    select s.id, s.date::text as date, s.status,
           to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as starts,
           to_char(s.ends_at at time zone 'Asia/Jerusalem', 'HH24:MI') as ends,
           extract(dow from s.date)::int as weekday, s.venue_id as "venueId", v.name as "venueName",
           s.class_template_id as "classTemplateId", ct.name as "groupName",
           (select staff_member_id from session_staff where session_id = s.id and role = 'lead') as "leadStaffId"
    from sessions s join class_templates ct on ct.id = s.class_template_id join venues v on v.id = s.venue_id
    where s.id = ${sessionId}`);
  const l = r.rows[0];
  if (!l) throw new DomainError('common.errors.notFound');
  return l;
}

type Lesson = Awaited<ReturnType<typeof lessonOf>>;

/** Every other active instructor, checked against the lesson. */
export async function substituteCandidates(
  tx: Tx,
  lesson: Lesson,
): Promise<(SubstituteCandidate & { exclusion: string | null })[]> {
  const [group] = await tx
    .select()
    .from(classTemplates)
    .where(eq(classTemplates.id, lesson.classTemplateId));
  if (!group) throw new DomainError('common.errors.notFound');
  const lanes = await tx
    .select({ laneId: classTemplateLanes.laneId })
    .from(classTemplateLanes)
    .where(eq(classTemplateLanes.classTemplateId, group.id));
  const { scheduling } = await rulesFor(tx, {
    date: lesson.date,
    venueId: lesson.venueId,
    programId: group.programId,
    classTemplateId: group.id,
  });
  const [staff, windows, others, certs, sameDay, history, week] = await Promise.all([
    listStaff(tx),
    poolWindows(tx, group.poolId),
    activeTemplates(tx),
    tx.select().from(certifications).where(eq(certifications.type, 'swim_instructor')),
    tx.execute<{ staff: string; venue: string; starts: string; ends: string }>(sql`
      select ss.staff_member_id as staff, s.venue_id as venue,
             to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as starts,
             to_char(s.ends_at at time zone 'Asia/Jerusalem', 'HH24:MI') as ends
      from sessions s join session_staff ss on ss.session_id = s.id
      where s.date = ${lesson.date}::date and s.status = 'scheduled' and s.id <> ${lesson.id}`),
    tx.execute<{ staff: string }>(sql`
      select distinct ss.staff_member_id as staff from sessions s join session_staff ss on ss.session_id = s.id
      where s.class_template_id = ${lesson.classTemplateId} and s.date < ${lesson.date}::date`),
    tx.execute<{ staff: string; n: number }>(sql`
      select ss.staff_member_id as staff, count(*)::int as n from sessions s join session_staff ss on ss.session_id = s.id
      where s.status = 'scheduled'
        and s.date between ${lesson.date}::date - extract(dow from ${lesson.date}::date)::int and ${lesson.date}::date + 6
      group by ss.staff_member_id`),
  ]);
  const start = toMinutes(lesson.starts);
  const end = toMinutes(lesson.ends);
  const draft: TemplateDraft = {
    id: group.id,
    venueId: group.venueId,
    poolId: group.poolId,
    weekday: lesson.weekday,
    startsAt: lesson.starts,
    durationMin: end - start,
    laneIds: lanes.map((l) => l.laneId),
    admittedGender: group.admittedGender as TemplateDraft['admittedGender'],
    ageMinMonths: group.ageMinMonths,
    effectiveFrom: lesson.date,
    effectiveTo: group.effectiveTo,
    requiredInstructorGender:
      group.requiredInstructorGender as TemplateDraft['requiredInstructorGender'],
    requiredSkills: group.requiredSkills,
    leadStaffId: null,
  };
  const window = windowFor(draft, windows);
  const out: (SubstituteCandidate & { exclusion: string | null })[] = [];
  for (const s of staff) {
    if (s.status !== 'active' || s.id === lesson.leadStaffId) continue;
    const facts = await instructorFacts(tx, s.id);
    const mine = sameDay.rows.filter((r) => r.staff === s.id);
    const candidate: SubstituteCandidate = {
      staffId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      violations: checkInstructor(
        { ...draft, leadStaffId: s.id },
        facts,
        others,
        scheduling,
        window,
        lesson.date,
      ).violations,
      certified: certs.some(
        (c) => c.staffMemberId === s.id && (c.expiresOn === null || c.expiresOn >= lesson.date),
      ),
      busy: mine.some((r) => toMinutes(r.starts) < end && start < toMinutes(r.ends)),
      knowsGroup: history.rows.some((r) => r.staff === s.id),
      atVenueThatDay: mine.some((r) => r.venue === lesson.venueId),
      lessonsThisWeek: week.rows.find((r) => r.staff === s.id)?.n ?? 0,
    };
    out.push({ ...candidate, exclusion: substituteExclusion(candidate) });
  }
  return out;
}

/**
 * Opens a request for a lesson and sends the first wave. With nobody qualified the request is opened as unfilled so
 * the owner sees it. One open request per lesson.
 */
export async function requestSubstitute(tx: Tx, ctx: ServiceContext, raw: SubstituteRequestInput) {
  const input = SubstituteRequestInput.parse(raw);
  const lesson = await lessonOf(tx, input.sessionId);
  if (lesson.status !== 'scheduled' || lesson.date < (await todayIL(tx))) {
    throw new DomainError('scheduling.substitute.notUpcoming');
  }
  const [group] = await tx
    .select({ programId: classTemplates.programId })
    .from(classTemplates)
    .where(eq(classTemplates.id, lesson.classTemplateId));
  const { staffing } = await rulesFor(tx, {
    date: lesson.date,
    venueId: lesson.venueId,
    programId: (group as { programId: string }).programId,
    classTemplateId: lesson.classTemplateId,
  });
  const candidates = await substituteCandidates(tx, lesson);
  const ranked = rankSubstitutes(candidates, staffing.substituteWaveSize);
  const now = new Date();
  const [req] = await tx
    .insert(substituteRequests)
    .values({
      organizationId: ctx.orgId,
      sessionId: lesson.id,
      fromStaffId: lesson.leadStaffId,
      reason: input.reason,
      lesson: {
        date: lesson.date,
        startsAt: lesson.starts,
        endsAt: lesson.ends,
        groupName: lesson.groupName,
        venueName: lesson.venueName,
      },
      status: ranked.length ? 'open' : 'unfilled',
      wave: ranked.length ? 1 : 0,
      nextWaveAt: ranked.length
        ? new Date(now.getTime() + staffing.substituteWaveMinutes * 60_000)
        : null,
      requestedBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning({ id: substituteRequests.id, status: substituteRequests.status });
  if (!req) throw new DomainError('scheduling.substitute.alreadyOpen');
  if (ranked.length) {
    await tx.insert(substituteOffers).values(
      ranked.map((r) => ({
        organizationId: ctx.orgId,
        requestId: req.id,
        staffMemberId: r.staffId,
        wave: r.wave,
        rank: r.rank,
        reasons: r.reasons,
        status: r.wave === 1 ? 'offered' : 'queued',
        offeredAt: r.wave === 1 ? now : null,
      })),
    );
  }
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'staffing.substitute_requested',
    payload: {
      requestId: req.id,
      sessionId: lesson.id,
      offered: ranked.filter((r) => r.wave === 1).length,
    },
    idempotencyKey: `staffing.substitute_requested:${req.id}`,
  });
  return {
    id: req.id,
    status: req.status,
    offered: ranked.filter((r) => r.wave === 1).length,
    ranked,
  };
}

/**
 * The worker's wave step: open requests whose wave timed out offer the next wave, or become unfilled when nobody is
 * left (the owner sees them on the substitutes screen).
 */
export async function advanceSubstituteWaves(tx: Tx, ctx: ServiceContext, now: Date = new Date()) {
  const due = await tx
    .select()
    .from(substituteRequests)
    .where(and(eq(substituteRequests.status, 'open'), lte(substituteRequests.nextWaveAt, now)))
    .for('update', { skipLocked: true });
  let advanced = 0;
  let unfilled = 0;
  for (const r of due) {
    const wave = r.wave + 1;
    const next = await tx
      .update(substituteOffers)
      .set({ status: 'offered', offeredAt: now })
      .where(
        and(
          eq(substituteOffers.requestId, r.id),
          eq(substituteOffers.wave, wave),
          eq(substituteOffers.status, 'queued'),
        ),
      )
      .returning({ id: substituteOffers.id });
    if (next.length > 0) {
      const lesson = r.lesson as { date: string };
      const [s] = await tx
        .select({ venueId: sessions.venueId })
        .from(sessions)
        .where(eq(sessions.id, r.sessionId));
      const [g] = await tx
        .select({ programId: classTemplates.programId, id: classTemplates.id })
        .from(classTemplates)
        .innerJoin(sessions, eq(sessions.classTemplateId, classTemplates.id))
        .where(eq(sessions.id, r.sessionId));
      const { staffing } = await rulesFor(tx, {
        date: lesson.date,
        venueId: (s as { venueId: string }).venueId,
        programId: (g as { programId: string }).programId,
        classTemplateId: (g as { id: string }).id,
      });
      await tx
        .update(substituteRequests)
        .set({
          wave,
          nextWaveAt: new Date(now.getTime() + staffing.substituteWaveMinutes * 60_000),
        })
        .where(eq(substituteRequests.id, r.id));
      advanced++;
    } else {
      await tx
        .update(substituteRequests)
        .set({ status: 'unfilled', nextWaveAt: null })
        .where(eq(substituteRequests.id, r.id));
      await emit(tx, {
        organizationId: ctx.orgId,
        type: 'staffing.substitute_unfilled',
        payload: { requestId: r.id, sessionId: r.sessionId },
        idempotencyKey: `staffing.substitute_unfilled:${r.id}`,
      });
      unfilled++;
    }
  }
  return { advanced, unfilled };
}

export const OfferAnswer = z.object({
  offerId: z.uuid(),
  accept: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});
export type OfferAnswer = z.input<typeof OfferAnswer>;

/**
 * An instructor answers their own offer. Accepting fills the request if nobody got there first (the database decides,
 * under a lock); otherwise `scheduling.substitute.taken`.
 */
export async function answerSubstituteOffer(
  tx: Tx,
  ctx: ServiceContext,
  staffId: string,
  raw: OfferAnswer,
) {
  const input = OfferAnswer.parse(raw);
  let row: { id: string; requestId: string } | undefined;
  try {
    [row] = await tx
      .update(substituteOffers)
      .set({ status: input.accept ? 'accepted' : 'declined' })
      .where(
        and(
          eq(substituteOffers.id, input.offerId),
          eq(substituteOffers.staffMemberId, staffId),
          eq(substituteOffers.status, 'offered'),
        ),
      )
      .returning({ id: substituteOffers.id, requestId: substituteOffers.requestId });
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
  if (!row) throw new DomainError('scheduling.substitute.offerClosed');
  if (input.accept) {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'staffing.substitute_accepted',
      payload: { requestId: row.requestId, offerId: row.id, staffId },
      idempotencyKey: `staffing.substitute_accepted:${row.requestId}`,
    });
  }
  return input.accept ? 'accepted' : 'declined';
}

/**
 * The worker puts the accepted substitute on the lesson (once) and emits `scheduling.staff_changed`, the event that
 * tells the parents who is teaching today.
 */
export async function applySubstitute(
  tx: Tx,
  ctx: ServiceContext,
  requestId: string,
): Promise<boolean> {
  const [r] = await tx
    .select()
    .from(substituteRequests)
    .where(eq(substituteRequests.id, requestId))
    .for('update');
  if (!r) throw new DomainError('common.errors.notFound');
  if (r.status !== 'filled' || r.appliedAt) return false;
  const to = r.filledBy as string;
  const [s] = await tx
    .select({ classTemplateId: sessions.classTemplateId })
    .from(sessions)
    .where(eq(sessions.id, r.sessionId));
  await setLead(tx, ctx, [r.sessionId], to);
  await tx
    .update(substituteRequests)
    .set({ appliedAt: new Date() })
    .where(eq(substituteRequests.id, r.id));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.staff_changed',
    payload: {
      substituteRequestId: r.id,
      kind: 'substitute',
      classTemplateId: s?.classTemplateId ?? null,
      sessionIds: [r.sessionId],
      fromStaffId: r.fromStaffId,
      toStaffId: to,
      acceptedByInstructor: true,
    },
    idempotencyKey: `scheduling.staff_changed:substitute:${r.id}`,
  });
  return true;
}

/** The office withdraws an open request (the instructor can teach after all). */
export async function cancelSubstituteRequest(tx: Tx, id: string) {
  const updated = await tx
    .update(substituteRequests)
    .set({ status: 'cancelled', nextWaveAt: null })
    .where(
      and(eq(substituteRequests.id, id), inArray(substituteRequests.status, ['open', 'unfilled'])),
    )
    .returning({ id: substituteRequests.id });
  if (updated.length === 0) throw new DomainError('scheduling.substitute.notOpen');
  await tx
    .update(substituteOffers)
    .set({ status: 'withdrawn' })
    .where(
      and(
        eq(substituteOffers.requestId, id),
        inArray(substituteOffers.status, ['queued', 'offered']),
      ),
    );
}

/** Requests with their offers, newest first, for the office. */
export async function listSubstituteRequests(tx: Tx, q: { status?: string } = {}) {
  const requests = await tx
    .select()
    .from(substituteRequests)
    .where(q.status ? eq(substituteRequests.status, q.status) : undefined)
    .orderBy(desc(substituteRequests.createdAt))
    .limit(100);
  const offers = requests.length
    ? await tx
        .select()
        .from(substituteOffers)
        .where(
          inArray(
            substituteOffers.requestId,
            requests.map((r) => r.id),
          ),
        )
        .orderBy(asc(substituteOffers.rank))
    : [];
  const staff = await listStaff(tx);
  const name = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : '';
  };
  return requests.map((r) => ({
    ...r,
    lesson: r.lesson as LessonSnapshot,
    fromName: name(r.fromStaffId),
    filledName: name(r.filledBy),
    offers: offers
      .filter((o) => o.requestId === r.id)
      .map((o) => ({ ...o, name: name(o.staffMemberId) })),
  }));
}

export interface LessonSnapshot {
  date: string;
  startsAt: string;
  endsAt: string;
  groupName: string;
  venueName: string;
}

/** An instructor's offers (RLS: their own, from the first wave that reached them). */
export async function myOffers(tx: Tx, staffId: string) {
  const offers = await tx
    .select({
      id: substituteOffers.id,
      status: substituteOffers.status,
      offeredAt: substituteOffers.offeredAt,
      requestStatus: substituteRequests.status,
      lesson: substituteRequests.lesson,
    })
    .from(substituteOffers)
    .innerJoin(substituteRequests, eq(substituteRequests.id, substituteOffers.requestId))
    .where(eq(substituteOffers.staffMemberId, staffId))
    .orderBy(desc(substituteOffers.offeredAt))
    .limit(50);
  return offers.map((o) => ({ ...o, lesson: o.lesson as LessonSnapshot }));
}

/** Upcoming lessons (from today) the office may ask a substitute for, with their lead instructor. */
export async function upcomingLessons(
  tx: Tx,
  q: { from: string; to: string; staffId?: string | null },
) {
  const r = await tx.execute<{
    id: string;
    date: string;
    starts: string;
    groupName: string;
    venueName: string;
    leadStaffId: string | null;
    openRequest: boolean;
  }>(sql`
    select s.id, s.date::text as date, to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as starts,
           ct.name as "groupName", v.name as "venueName", ss.staff_member_id as "leadStaffId",
           exists (select 1 from substitute_requests r where r.session_id = s.id and r.status = 'open') as "openRequest"
    from sessions s join class_templates ct on ct.id = s.class_template_id join venues v on v.id = s.venue_id
    left join session_staff ss on ss.session_id = s.id and ss.role = 'lead'
    where s.status = 'scheduled' and s.date between ${q.from}::date and ${q.to}::date
      ${q.staffId ? sql`and ss.staff_member_id = ${q.staffId}::uuid` : sql``}
    order by s.date, s.starts_at`);
  return r.rows;
}

/** The coming stretch's lessons without a lead instructor, merged into gaps (brief §6.8). */
export async function staffingGapsFor(tx: Tx, q: { from: string; to: string }) {
  const r = await tx.execute<{
    date: string;
    weekday: number;
    venueId: string;
    venueName: string;
    startsAt: string;
    endsAt: string;
    groupName: string;
    hasLead: boolean;
  }>(sql`
    select s.date::text as date, extract(dow from s.date)::int as weekday, s.venue_id as "venueId",
           v.name as "venueName",
           to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as "startsAt",
           to_char(s.ends_at at time zone 'Asia/Jerusalem', 'HH24:MI') as "endsAt",
           ct.name as "groupName",
           exists (select 1 from session_staff ss where ss.session_id = s.id and ss.role = 'lead') as "hasLead"
    from sessions s join class_templates ct on ct.id = s.class_template_id join venues v on v.id = s.venue_id
    where s.status = 'scheduled' and s.date between ${q.from}::date and ${q.to}::date`);
  const names = new Map(r.rows.map((x) => [x.venueId, x.venueName]));
  return staffingGaps(r.rows).map((g) => ({ ...g, venueName: names.get(g.venueId) ?? '' }));
}
