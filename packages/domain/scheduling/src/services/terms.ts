/** Terms, calendar overrides and the session generator (brief §6.3, Phase 2 AC 1). */
import { z } from 'zod';
import { optionalText, requiredDate, requiredText, TERM_KINDS } from '@rswim/contracts';
import { and, asc, desc, eq, gte, inArray, lte, or, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { loadPolicyResolver } from '@rswim/domain-settings';
import { calendarPolicyFrom, planSessions, type SkippedDate } from '../policies';
import { optionalUuid } from './shared';

const {
  terms,
  hebrewCalendarOverrides,
  classTemplates,
  sessions,
  sessionStaff,
  sessionGenerationRuns,
  venueClosures,
} = schema;

export const TermInput = z
  .object({
    name: requiredText(120),
    kind: z.enum(TERM_KINDS),
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    notes: optionalText(500),
  })
  .refine((t) => t.endsOn >= t.startsOn, {
    message: 'forms.errors.datesReversed',
    path: ['endsOn'],
  });
export type TermInput = z.infer<typeof TermInput>;

export const OverrideInput = z.object({
  date: requiredDate(),
  kind: z.enum(['closed', 'open']),
  venueId: optionalUuid(),
  reason: requiredText(200),
});
export type OverrideInput = z.infer<typeof OverrideInput>;

export async function listTerms(tx: Tx) {
  return tx.select().from(terms).orderBy(desc(terms.startsOn));
}

export async function getTerm(tx: Tx, termId: string) {
  const [term] = await tx.select().from(terms).where(eq(terms.id, termId));
  if (!term) return null;
  const runs = await tx
    .select()
    .from(sessionGenerationRuns)
    .where(eq(sessionGenerationRuns.termId, termId))
    .orderBy(desc(sessionGenerationRuns.createdAt))
    .limit(5);
  const [counts] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(eq(sessions.termId, termId));
  return {
    term,
    runs: runs.map((r) => ({ ...r, skipped: r.skipped as SkippedRow[] })),
    sessionCount: counts?.n ?? 0,
  };
}

/** The term in effect on a date, or the next one to start. */
export async function currentTerm(tx: Tx, onDate: string) {
  const rows = await tx
    .select()
    .from(terms)
    .where(gte(terms.endsOn, onDate))
    .orderBy(asc(terms.startsOn));
  return rows.find((t) => t.startsOn <= onDate) ?? rows[0] ?? null;
}

export async function createTerm(tx: Tx, ctx: ServiceContext, input: TermInput): Promise<string> {
  const [row] = await tx
    .insert(terms)
    .values({ ...input, organizationId: ctx.orgId })
    .returning({ id: terms.id });
  return (row as { id: string }).id;
}

export async function updateTerm(tx: Tx, termId: string, input: TermInput) {
  await tx.update(terms).set(input).where(eq(terms.id, termId));
}

export async function listOverrides(tx: Tx, from: string) {
  return tx
    .select()
    .from(hebrewCalendarOverrides)
    .where(gte(hebrewCalendarOverrides.date, from))
    .orderBy(asc(hebrewCalendarOverrides.date));
}

export async function addOverride(tx: Tx, ctx: ServiceContext, input: OverrideInput) {
  await tx.insert(hebrewCalendarOverrides).values({ ...input, organizationId: ctx.orgId });
}

export async function deleteOverride(tx: Tx, id: string) {
  await tx.delete(hebrewCalendarOverrides).where(eq(hebrewCalendarOverrides.id, id));
}

export type SkippedRow = SkippedDate & { classTemplateId: string; groupName: string };

export interface GenerationReport {
  runId: string;
  created: number;
  existing: number;
  skipped: SkippedRow[];
}

/**
 * Generates the term's sessions for every active group that overlaps it (or the given groups). Dates are decided by
 * the Hebrew calendar under each group's resolved policy, minus overrides and venue closures. Running it again only
 * adds what is missing; a date already generated is counted as existing, never duplicated. The lead instructor of
 * the group staffs each new session.
 */
export async function generateSessions(
  tx: Tx,
  ctx: ServiceContext,
  termId: string,
  templateIds?: readonly string[],
): Promise<GenerationReport> {
  const [term] = await tx.select().from(terms).where(eq(terms.id, termId));
  if (!term) throw new DomainError('common.errors.notFound');
  const groups = await tx
    .select()
    .from(classTemplates)
    .where(
      and(
        eq(classTemplates.status, 'active'),
        lte(classTemplates.effectiveFrom, term.endsOn),
        or(isNull(classTemplates.effectiveTo), gte(classTemplates.effectiveTo, term.startsOn)),
        templateIds ? inArray(classTemplates.id, [...templateIds]) : undefined,
      ),
    );
  const [closures, overrides, resolve] = await Promise.all([
    tx
      .select()
      .from(venueClosures)
      .where(
        and(lte(venueClosures.startsOn, term.endsOn), gte(venueClosures.endsOn, term.startsOn)),
      ),
    tx
      .select()
      .from(hebrewCalendarOverrides)
      .where(
        and(
          gte(hebrewCalendarOverrides.date, term.startsOn),
          lte(hebrewCalendarOverrides.date, term.endsOn),
        ),
      ),
    loadPolicyResolver(tx),
  ]);

  const [run] = await tx
    .insert(sessionGenerationRuns)
    .values({ organizationId: ctx.orgId, termId, requestedBy: ctx.userId })
    .returning({ id: sessionGenerationRuns.id });
  const runId = (run as { id: string }).id;

  let created = 0;
  let existing = 0;
  const skipped: SkippedRow[] = [];
  for (const g of groups) {
    const plan = planSessions(
      g,
      term,
      (date) => {
        const r = resolve({
          date,
          venueId: g.venueId,
          programId: g.programId,
          classTemplateId: g.id,
        });
        return { calendar: calendarPolicyFrom(r.rules), versionKey: r.versionKey };
      },
      closures,
      overrides.map((o) => ({ ...o, kind: o.kind as 'closed' | 'open' })),
    );
    skipped.push(...plan.skipped.map((s) => ({ ...s, classTemplateId: g.id, groupName: g.name })));
    if (plan.sessions.length === 0) continue;
    const endTime = sql`(${g.startsAt}::time + make_interval(mins => ${g.durationMin}))`;
    const rows = plan.sessions.map((p) => sql`(${p.date}::date, ${p.policyVersionKey})`);
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into sessions (organization_id, class_template_id, term_id, venue_id, date, starts_at, ends_at,
                            generation_run_id, policy_version_key)
      select ${ctx.orgId}, ${g.id}, ${termId}, ${g.venueId}, x.d,
             ((x.d + ${g.startsAt}::time) at time zone 'Asia/Jerusalem'),
             ((x.d + ${endTime}) at time zone 'Asia/Jerusalem'),
             ${runId}, x.k
      from (values ${sql.join(rows, sql`, `)}) as x(d, k)
      on conflict (class_template_id, date) do nothing
      returning id`);
    created += inserted.rows.length;
    existing += plan.sessions.length - inserted.rows.length;
    if (g.leadStaffId && inserted.rows.length) {
      await tx.insert(sessionStaff).values(
        inserted.rows.map((r) => ({
          organizationId: ctx.orgId,
          sessionId: r.id,
          staffMemberId: g.leadStaffId as string,
          role: 'lead',
        })),
      );
    }
  }
  skipped.sort((a, b) => a.date.localeCompare(b.date) || a.groupName.localeCompare(b.groupName));
  await tx
    .update(sessionGenerationRuns)
    .set({ createdCount: created, existingCount: existing, skipped })
    .where(eq(sessionGenerationRuns.id, runId));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.sessions_generated',
    payload: { termId, runId, created, existing, skipped: skipped.length },
    idempotencyKey: `scheduling.sessions_generated:${runId}`,
  });
  return { runId, created, existing, skipped };
}
