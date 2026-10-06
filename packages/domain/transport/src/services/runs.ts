/**
 * Each day's runs (brief §6.10). A run opens for every active route on its weekdays when its group has a lesson that
 * day; the escort taps the stages (left the school, at the pool, in and out of the water, left the pool, done) and
 * marks each child (on board, not at the pickup, dropped off). Stages families hear about are emitted for the
 * communications hub; the run report answers how long the children were really in the water.
 */
import { z } from 'zod';
import {
  NOTIFIED_STAGES,
  RiderMark,
  RunStage,
  requiredDate,
  type RiderMark as Mark,
} from '@rswim/contracts';
import { and, asc, eq, inArray, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { groupLessonsOn, lessonTimes } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  isStale,
  nextStage,
  onBoard,
  riderCheck,
  runSummary,
  runsOn as routeRunsOn,
  stageCheck,
  transportRulesFrom,
  type RunSummary,
} from '../policies';
import { guarded, listRoutes, ridersOf, type RiderView, type RouteView } from './routes';

const { routeRuns, runEvents, transportRoutes } = schema;

async function myStaffId(tx: Tx): Promise<string | null> {
  const r = await tx.execute<{ id: string | null }>(
    sql`select app.current_staff_member_id() as id`,
  );
  return r.rows[0]?.id ?? null;
}

// ─── Opening runs ───────────────────────────────────────────────────────────

/**
 * Opens a date's runs: each active route that runs on that weekday, for its group's lesson that day. A cancelled
 * lesson (a closure, a holiday) means the route stays home. Running it again changes nothing. An escort opens only
 * today's runs of their own routes.
 */
export async function planRuns(
  tx: Tx,
  ctx: ServiceContext,
  date: string,
  o: { escortStaffId?: string } = {},
): Promise<number> {
  const routes = (
    await tx
      .select()
      .from(transportRoutes)
      .where(
        and(
          eq(transportRoutes.active, true),
          o.escortStaffId ? eq(transportRoutes.escortStaffId, o.escortStaffId) : undefined,
        ),
      )
  ).filter((r) => routeRunsOn(r.weekdays, date));
  if (routes.length === 0) return 0;
  const lessons = await groupLessonsOn(
    tx,
    routes.map((r) => r.classTemplateId),
    date,
  );
  let opened = 0;
  for (const r of routes) {
    const lesson = lessons.find((l) => l.templateId === r.classTemplateId);
    if (!lesson || lesson.status !== 'scheduled') continue;
    const rows = await tx
      .insert(routeRuns)
      .values({
        organizationId: ctx.orgId,
        routeId: r.id,
        date,
        escortStaffId: r.escortStaffId,
        sessionId: lesson.sessionId,
      })
      .onConflictDoNothing()
      .returning({ id: routeRuns.id });
    opened += rows.length;
  }
  return opened;
}

export const OpenRunInput = z.object({ routeId: z.uuid(), date: requiredDate() });

/** The office opens a route's run by hand for a date (an extra day, a run the plan skipped). */
export async function openRun(tx: Tx, ctx: ServiceContext, raw: z.input<typeof OpenRunInput>) {
  const input = OpenRunInput.parse(raw);
  const [route] = await tx
    .select()
    .from(transportRoutes)
    .where(eq(transportRoutes.id, input.routeId));
  if (!route) throw new DomainError('common.errors.notFound');
  const [lesson] = (await groupLessonsOn(tx, [route.classTemplateId], input.date)).filter(
    (l) => l.status === 'scheduled',
  );
  await guarded(() =>
    tx
      .insert(routeRuns)
      .values({
        organizationId: ctx.orgId,
        routeId: route.id,
        date: input.date,
        escortStaffId: route.escortStaffId,
        sessionId: lesson?.sessionId ?? null,
      })
      .onConflictDoNothing(),
  );
  const [run] = await tx
    .select({ id: routeRuns.id })
    .from(routeRuns)
    .where(and(eq(routeRuns.routeId, route.id), eq(routeRuns.date, input.date)));
  return (run as { id: string }).id;
}

/** The office calls off a run that has not left yet. */
export async function cancelRun(tx: Tx, runId: string) {
  const rows = await tx
    .update(routeRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(routeRuns.id, runId), eq(routeRuns.status, 'planned')))
    .returning({ id: routeRuns.id });
  if (rows.length === 0) throw new DomainError('transport.errors.alreadyLeft');
}

// ─── Recording ──────────────────────────────────────────────────────────────

async function runOf(tx: Tx, runId: string) {
  const [run] = await tx.select().from(routeRuns).where(eq(routeRuns.id, runId));
  if (!run) throw new DomainError('common.errors.notFound');
  if (run.status === 'cancelled') throw new DomainError('transport.errors.cancelled');
  return run;
}

async function eventsOf(tx: Tx, runIds: readonly string[]) {
  if (runIds.length === 0) return [];
  return tx
    .select()
    .from(runEvents)
    .where(inArray(runEvents.runId, [...runIds]))
    .orderBy(asc(runEvents.at));
}

const stagesIn = (events: readonly { kind: string; studentId: string | null }[]) =>
  events.filter((e) => e.studentId === null).map((e) => e.kind as RunStage);

export const StageInput = z.object({ runId: z.uuid(), stage: RunStage });

/** The escort taps a stage. Stages families hear about become events for the communications hub. */
export async function recordStage(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof StageInput>,
): Promise<{ eventId: string }> {
  const input = StageInput.parse(raw);
  const run = await runOf(tx, input.runId);
  const check = stageCheck(stagesIn(await eventsOf(tx, [run.id])), input.stage);
  if (!check.ok) throw new DomainError(check.code);
  const [row] = await guarded(() =>
    tx
      .insert(runEvents)
      .values({
        organizationId: ctx.orgId,
        runId: run.id,
        kind: input.stage,
        recordedBy: ctx.userId,
      })
      .returning({ id: runEvents.id }),
  );
  const eventId = (row as { id: string }).id;
  const type = (NOTIFIED_STAGES as Partial<Record<RunStage, string>>)[input.stage];
  if (type) {
    // The payload is not trusted: the worker reads the event row back.
    await emit(tx, {
      organizationId: ctx.orgId,
      type,
      payload: { eventId, runId: run.id },
      idempotencyKey: `${type}:${eventId}`,
    });
  }
  return { eventId };
}

export const MarkInput = z.object({ runId: z.uuid(), studentId: z.uuid(), mark: RiderMark });

/** The escort marks a child: on board, not at the pickup, or dropped off at their point. */
export async function markRider(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof MarkInput>,
): Promise<{ eventId: string }> {
  const input = MarkInput.parse(raw);
  const run = await runOf(tx, input.runId);
  const riders = await ridersOf(tx, [run.routeId], run.date);
  if (!riders.some((r) => r.studentId === input.studentId))
    throw new DomainError('transport.errors.notRider');
  const events = await eventsOf(tx, [run.id]);
  const marks = events.filter((e) => e.studentId === input.studentId).map((e) => e.kind as Mark);
  const check = riderCheck(stagesIn(events), marks, input.mark);
  if (!check.ok) throw new DomainError(check.code);
  const [row] = await guarded(() =>
    tx
      .insert(runEvents)
      .values({
        organizationId: ctx.orgId,
        runId: run.id,
        kind: input.mark,
        studentId: input.studentId,
        recordedBy: ctx.userId,
      })
      .returning({ id: runEvents.id }),
  );
  const eventId = (row as { id: string }).id;
  if (input.mark === 'dropped_off') {
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'transport.rider_dropped',
      payload: { eventId, runId: run.id },
      idempotencyKey: `transport.rider_dropped:${eventId}`,
    });
  }
  return { eventId };
}

/** The office removes a mistaken tap (the audit log keeps it). */
export async function removeEvent(tx: Tx, eventId: string) {
  const rows = await tx
    .delete(runEvents)
    .where(eq(runEvents.id, eventId))
    .returning({ id: runEvents.id });
  if (rows.length === 0) throw new DomainError('common.errors.notFound');
}

// ─── Reading ────────────────────────────────────────────────────────────────

export type RiderOnRun = RiderView & { marks: { mark: Mark; at: Date }[] };

export interface RunView {
  run: typeof routeRuns.$inferSelect;
  route: RouteView;
  riders: RiderOnRun[];
  stages: { id: string; stage: RunStage; at: Date }[];
  next: RunStage | null;
  lesson: { startsAt: Date; minutes: number } | null;
  summary: RunSummary;
}

async function views(tx: Tx, runs: (typeof routeRuns.$inferSelect)[]): Promise<RunView[]> {
  if (runs.length === 0) return [];
  const routes = await listRoutes(tx, [...new Set(runs.map((r) => r.routeId))]);
  const route = new Map(routes.map((r) => [r.id, r]));
  const events = await eventsOf(
    tx,
    runs.map((r) => r.id),
  );
  const lessons = await lessonTimes(
    tx,
    runs.flatMap((r) => (r.sessionId ? [r.sessionId] : [])),
  );
  const rulesByDate = new Map<string, ReturnType<typeof transportRulesFrom>>();
  const out: RunView[] = [];
  for (const run of runs) {
    const rt = route.get(run.routeId);
    if (!rt) continue;
    let rules = rulesByDate.get(run.date);
    if (!rules) {
      rules = transportRulesFrom((await resolvePolicyFor(tx, { date: run.date })).rules);
      rulesByDate.set(run.date, rules);
    }
    const mine = events.filter((e) => e.runId === run.id);
    const stages = mine
      .filter((e) => e.studentId === null)
      .map((e) => ({ id: e.id, stage: e.kind as RunStage, at: e.at }));
    const riders = (await ridersOf(tx, [run.routeId], run.date)).map((r) => ({
      ...r,
      marks: mine
        .filter((e) => e.studentId === r.studentId)
        .map((e) => ({ mark: e.kind as Mark, at: e.at })),
    }));
    const lesson = run.sessionId ? (lessons.get(run.sessionId) ?? null) : null;
    out.push({
      run,
      route: rt,
      riders,
      stages,
      next: run.status === 'cancelled' ? null : nextStage(stages.map((s) => s.stage)),
      lesson,
      summary: runSummary(stages, lesson, rules),
    });
  }
  return out;
}

/** The runs of a date the caller may see (the office: all; an escort: theirs; a family: their children's). */
export async function runsOnDate(tx: Tx, date: string): Promise<RunView[]> {
  const runs = await tx
    .select()
    .from(routeRuns)
    .where(eq(routeRuns.date, date))
    .orderBy(asc(routeRuns.createdAt));
  return (await views(tx, runs)).sort((a, b) =>
    a.route.leavesSchoolAt.localeCompare(b.route.leavesSchoolAt),
  );
}

/** Runs between two dates, newest first (the run report). */
export async function runsBetween(tx: Tx, from: string, to: string, routeId?: string) {
  const runs = await tx
    .select()
    .from(routeRuns)
    .where(
      and(
        sql`${routeRuns.date} between ${from}::date and ${to}::date`,
        routeId ? eq(routeRuns.routeId, routeId) : undefined,
      ),
    )
    .orderBy(sql`${routeRuns.date} desc`);
  return views(tx, runs);
}

export async function getRun(tx: Tx, runId: string): Promise<RunView | null> {
  const runs = await tx.select().from(routeRuns).where(eq(routeRuns.id, runId));
  const [v] = await views(tx, runs);
  return v ?? null;
}

/** The escort's day: today's runs of their routes are opened if missing, then listed. */
export async function escortDay(tx: Tx, ctx: ServiceContext, today: string): Promise<RunView[]> {
  const staffId = await myStaffId(tx);
  if (!staffId) return [];
  await planRuns(tx, ctx, today, { escortStaffId: staffId });
  return runsOnDate(tx, today);
}

// ─── For the communications hub ─────────────────────────────────────────────

export interface StageAudience {
  stage: RunStage;
  studentIds: string[];
  school: string;
  venue: string;
  group: string;
  rideMinutes: number;
  at: Date;
}

/**
 * Who hears about a stage the escort tapped, and the words: the children on board (or every rider not marked
 * missing). Nothing for an event that is gone or too old to be news.
 */
export async function stageAudience(
  tx: Tx,
  eventId: string,
  now = new Date(),
): Promise<StageAudience | null> {
  const [e] = await tx
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.id, eventId), isNull(runEvents.studentId)));
  if (!e) return null;
  const [v] = await views(tx, await tx.select().from(routeRuns).where(eq(routeRuns.id, e.runId)));
  if (!v) return null;
  const rules = transportRulesFrom((await resolvePolicyFor(tx, { date: v.run.date })).rules);
  if (isStale(e.at, now, rules)) return null;
  const marks = v.riders.flatMap((r) => r.marks.map((m) => ({ studentId: r.studentId, ...m })));
  return {
    stage: e.kind as RunStage,
    studentIds: onBoard(
      v.riders.map((r) => r.studentId),
      marks,
    ),
    school: v.route.schoolName,
    venue: v.route.venueName,
    group: v.route.groupName,
    rideMinutes: v.route.rideMinutes,
    at: e.at,
  };
}

/** The family of a child just dropped off, and where. */
export async function dropAudience(tx: Tx, eventId: string, now = new Date()) {
  const [e] = await tx.select().from(runEvents).where(eq(runEvents.id, eventId));
  if (!e || e.kind !== 'dropped_off' || !e.studentId) return null;
  const [v] = await views(tx, await tx.select().from(routeRuns).where(eq(routeRuns.id, e.runId)));
  const rider = v?.riders.find((r) => r.studentId === e.studentId);
  if (!v || !rider) return null;
  const rules = transportRulesFrom((await resolvePolicyFor(tx, { date: v.run.date })).rules);
  if (isStale(e.at, now, rules)) return null;
  return {
    studentId: e.studentId,
    point: rider.dropoffPoint ?? v.route.schoolName,
    at: e.at,
  };
}
