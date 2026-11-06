/**
 * The brain's memory of the business (docs/AI-BRAIN.md, stage 5). Three things, all the owner's alone (RLS):
 *
 * - **Month by month**: the facts of every month (places, money, lessons, attendance, trials), refreshed daily for the
 *   running month and kept once a month ended, so "how was April" and "against last year" read stored rows.
 * - **Events**: what happened (lessons cancelled, a substitute search, new prices, a group opened or closed), recorded
 *   once by the daily sweep from the modules' own rows.
 * - **Notes**: what the owner asked it to remember ("תזכור ש..."), in her words, from the chat, WhatsApp or the screen.
 *
 * The chat reads all three through its tools; the owner archives a memory that is wrong or no longer true.
 */
import {
  RememberInput,
  type MemoryKind,
  type MemorySource,
  type MemorySubject,
} from '@rswim/contracts';
import { and, desc, eq, isNull, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  firstActiveMonth,
  monthChange,
  monthFacts,
  type MeasureChange,
  type MonthFacts,
} from '@rswim/domain-reports';
import { todayIL } from '@rswim/domain-scheduling';
import { periodOf, shiftPeriod, snapshotDue } from './memory-policies';
import type { Explanation } from './policies';

const { businessMemories, businessSnapshots } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

/** How far back the first refresh reaches for a school with history. */
export const MEMORY_BACKFILL_MONTHS = 24;
/** How far back the sweep looks for events it has not recorded yet. */
const SWEEP_DAYS = 400;

// ─── Month by month ─────────────────────────────────────────────────────────

/**
 * Computes the months that need it: the running month every day, a month that ended once more after its end, and on the
 * first run every month back to the school's first activity (at most two years).
 */
export async function refreshSnapshots(
  tx: Tx,
  ctx: ServiceContext,
  today: string,
): Promise<number> {
  const first = await firstActiveMonth(tx);
  if (!first) return 0;
  const now = periodOf(today);
  const oldest = shiftPeriod(now, -(MEMORY_BACKFILL_MONTHS - 1));
  const stored = new Map(
    (
      await tx
        .select({ period: businessSnapshots.period, final: businessSnapshots.final })
        .from(businessSnapshots)
    ).map((r) => [r.period, r]),
  );
  let computed = 0;
  for (let p = first > oldest ? first : oldest; p <= now; p = shiftPeriod(p, 1)) {
    const due = snapshotDue(p, today, stored.get(p));
    if (!due.due) continue;
    const facts = await monthFacts(tx, p, today);
    await tx
      .insert(businessSnapshots)
      .values({ organizationId: ctx.orgId, period: p, facts, final: due.final })
      .onConflictDoUpdate({
        target: [businessSnapshots.organizationId, businessSnapshots.period],
        set: { facts, final: due.final },
      });
    computed++;
  }
  return computed;
}

export interface MonthSnapshot {
  period: string;
  facts: MonthFacts;
  final: boolean;
}

/** The stored months, newest first. */
export async function listSnapshots(tx: Tx, limit = 25): Promise<MonthSnapshot[]> {
  const r = await tx
    .select()
    .from(businessSnapshots)
    .orderBy(desc(businessSnapshots.period))
    .limit(limit);
  return r.map((s) => ({ period: s.period, facts: s.facts as MonthFacts, final: s.final }));
}

export interface MonthReport {
  period: string;
  facts: MonthFacts;
  /** Against the month before and the same month a year before; null when that month is not remembered. */
  previous: MeasureChange[] | null;
  lastYear: MeasureChange[] | null;
  /** What the brain remembers from that month. */
  memories: MemoryRow[];
}

/** One month as the brain remembers it, against the month before and the same month last year. */
export async function monthReport(tx: Tx, period: string): Promise<MonthReport> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new DomainError('agent.memory.errors.period');
  const stored = new Map(
    (
      await tx
        .select()
        .from(businessSnapshots)
        .where(
          sql`${businessSnapshots.period} in (${period}, ${shiftPeriod(period, -1)}, ${shiftPeriod(period, -12)})`,
        )
    ).map((s) => [s.period, s.facts as MonthFacts]),
  );
  const today = await todayIL(tx);
  const facts = stored.get(period) ?? (await monthFacts(tx, period, today));
  const prev = stored.get(shiftPeriod(period, -1));
  const year = stored.get(shiftPeriod(period, -12));
  const from = `${period}-01`;
  const to = `${shiftPeriod(period, 1)}-01`;
  return {
    period,
    facts,
    previous: prev ? monthChange(facts, prev) : null,
    lastYear: year ? monthChange(facts, year) : null,
    memories: (await listMemories(tx, { limit: 50 })).filter(
      (m) => m.happenedOn >= from && m.happenedOn < to,
    ),
  };
}

// ─── Events ─────────────────────────────────────────────────────────────────

/**
 * Records what happened in the business since the last sweep, each event once (`source_ref`): lessons cancelled by a
 * closure, a substitute search once it ended, a published price list, and a group that opened or closed (a group moved
 * to another venue is neither). Groups that existed from the school's first day are not news.
 */
export async function sweepEvents(tx: Tx, ctx: ServiceContext, today: string): Promise<number> {
  const since = sql`(${today}::date - ${SWEEP_DAYS}::int)`;
  const code = (k: string) => sql`${`agent.memory.events.${k}`}::text`;
  const insert = async (select: ReturnType<typeof sql>) =>
    (
      await tx.execute(
        sql`insert into business_memories (organization_id, kind, subject_type, subject_id, subject_label, summary,
                                           happened_on, source, source_ref)
            select ${ctx.orgId}::uuid, 'event', x.subject_type, x.subject_id, x.subject_label, x.summary,
                   x.happened_on, 'system', x.source_ref
            from (${select}) x
            on conflict (organization_id, source_ref) do nothing`,
      )
    ).rowCount ?? 0;
  let n = 0;
  n += await insert(
    sql`select case when c.venue_id is null then 'school' else 'venue' end subject_type, c.venue_id subject_id,
               v.name subject_label, c.starts_on happened_on, 'closure:' || c.id source_ref,
               jsonb_build_object('code', ${code('closure')}, 'params', jsonb_build_object(
                 'from', c.starts_on::text, 'until', c.ends_on::text, 'venue', coalesce(v.name, ''),
                 'reason', c.reason,
                 'sessions', (select count(*) from sessions s where s.closure_event_id = c.id))) summary
        from closure_events c left join venues v on v.id = c.venue_id
        where c.status in ('open', 'closed') and c.starts_on >= ${since}`,
  );
  n += await insert(
    sql`select 'staff' subject_type, r.from_staff_id subject_id, m.first_name || ' ' || m.last_name subject_label,
               s.date happened_on, 'substitute:' || r.id source_ref,
               jsonb_build_object('code', ${code('substitute')}, 'params', jsonb_build_object(
                 'staff', coalesce(m.first_name || ' ' || m.last_name, ''), 'group', t.name, 'date', s.date::text,
                 'outcome', r.status)) summary
        from substitute_requests r join sessions s on s.id = r.session_id
        join class_templates t on t.id = s.class_template_id
        left join staff_members m on m.id = r.from_staff_id
        where s.date >= ${since}
          and (r.status in ('filled', 'unfilled') or (r.status = 'open' and s.date < ${today}::date))`,
  );
  n += await insert(
    sql`select case when p.venue_id is null then 'school' else 'venue' end subject_type, p.venue_id subject_id,
               v.name subject_label, p.effective_from happened_on, 'price_list:' || p.id source_ref,
               jsonb_build_object('code', ${code('price_list')}, 'params', jsonb_build_object(
                 'name', p.name, 'from', p.effective_from::text)) summary
        from price_lists p left join venues v on v.id = p.venue_id
        where p.status in ('published', 'archived') and p.effective_from between ${since} and ${today}::date
          and p.effective_from > (select min(x.effective_from) from price_lists x where x.status <> 'draft')`,
  );
  const sameGroup = sql`o.id <> t.id and o.name = t.name and o.cohort_id is null`;
  n += await insert(
    sql`select 'group' subject_type, t.id subject_id, t.name subject_label, t.effective_from happened_on,
               'group_opened:' || t.id source_ref,
               jsonb_build_object('code', ${code('group_opened')}, 'params', jsonb_build_object(
                 'group', t.name, 'venue', v.name, 'from', t.effective_from::text)) summary
        from class_templates t join venues v on v.id = t.venue_id
        where t.cohort_id is null and t.effective_from between ${since} and ${today}::date
          and t.effective_from > (select min(x.effective_from) from class_templates x where x.cohort_id is null)
          and not exists (select 1 from class_templates o where ${sameGroup} and o.effective_to = t.effective_from)`,
  );
  n += await insert(
    sql`select 'group' subject_type, t.id subject_id, t.name subject_label, t.effective_to happened_on,
               'group_closed:' || t.id source_ref,
               jsonb_build_object('code', ${code('group_closed')}, 'params', jsonb_build_object(
                 'group', t.name, 'venue', v.name, 'until', t.effective_to::text)) summary
        from class_templates t join venues v on v.id = t.venue_id
        where t.cohort_id is null and t.effective_to between ${since} and ${today}::date
          and not exists (select 1 from class_templates o where ${sameGroup} and o.effective_from = t.effective_to)`,
  );
  return n;
}

/** The daily refresh: this month's facts (and any month not kept yet) and the events since yesterday. */
export async function refreshMemory(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ months: number; events: number }> {
  const today = await todayIL(tx);
  return {
    months: await refreshSnapshots(tx, ctx, today),
    events: await sweepEvents(tx, ctx, today),
  };
}

// ─── Notes ──────────────────────────────────────────────────────────────────

const SUBJECT_NAME: Record<
  Exclude<MemorySubject, 'school'>,
  (id: string) => ReturnType<typeof sql>
> = {
  household: (id) => sql`select display_name n from households where id = ${id}`,
  student: (id) => sql`select first_name || ' ' || last_name n from students where id = ${id}`,
  staff: (id) => sql`select first_name || ' ' || last_name n from staff_members where id = ${id}`,
  venue: (id) => sql`select name n from venues where id = ${id}`,
  group: (id) => sql`select name n from class_templates where id = ${id}`,
};

/** Keeps a note in the owner's words, about the school or one family, child, instructor, venue or group. */
export async function remember(
  tx: Tx,
  ctx: ServiceContext,
  raw: unknown,
  source: Exclude<MemorySource, 'system'>,
): Promise<{ id: string; subjectLabel: string | null }> {
  const parsed = RememberInput.safeParse(raw);
  if (!parsed.success) throw new DomainError('agent.memory.errors.note');
  const input = parsed.data;
  let label: string | null = null;
  if (input.subjectType !== 'school') {
    if (!input.subjectId) throw new DomainError('agent.memory.errors.subject');
    const [r] = await rows<{ n: string }>(tx, SUBJECT_NAME[input.subjectType](input.subjectId));
    if (!r) throw new DomainError('agent.memory.errors.subject');
    label = r.n;
  }
  const [row] = await tx
    .insert(businessMemories)
    .values({
      organizationId: ctx.orgId,
      kind: 'note',
      subjectType: input.subjectType,
      subjectId: input.subjectType === 'school' ? null : input.subjectId,
      subjectLabel: label,
      body: input.body,
      happenedOn: input.happenedOn ?? (await todayIL(tx)),
      source,
      createdBy: ctx.userId,
    })
    .returning({ id: businessMemories.id });
  return { id: (row as { id: string }).id, subjectLabel: label };
}

/** Takes a memory out of what the brain reads: wrong, or no longer true. Kept in the audit log. */
export async function archiveMemory(tx: Tx, _ctx: ServiceContext, id: string) {
  const r = await tx
    .update(businessMemories)
    .set({ archivedAt: new Date() })
    .where(and(eq(businessMemories.id, id), isNull(businessMemories.archivedAt)))
    .returning({ id: businessMemories.id });
  if (r.length === 0) throw new DomainError('agent.memory.errors.notFound');
}

export interface MemoryRow {
  id: string;
  kind: MemoryKind;
  subjectType: MemorySubject;
  subjectId: string | null;
  subjectLabel: string | null;
  body: string | null;
  summary: Explanation | null;
  happenedOn: string;
  source: MemorySource;
  createdAt: Date;
}

/**
 * What the brain remembers, newest first, archived ones left out. `query` matches a note's words, an event's
 * params or the subject's name; `subjectId` narrows to one family, child, instructor, venue or group.
 */
export async function listMemories(
  tx: Tx,
  opts: {
    kind?: MemoryKind;
    query?: string;
    subjectId?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<MemoryRow[]> {
  const q = opts.query?.trim();
  const like = q ? `%${q}%` : null;
  const r = await tx
    .select()
    .from(businessMemories)
    .where(
      and(
        isNull(businessMemories.archivedAt),
        opts.kind ? eq(businessMemories.kind, opts.kind) : undefined,
        opts.subjectId ? eq(businessMemories.subjectId, opts.subjectId) : undefined,
        opts.from ? sql`${businessMemories.happenedOn} >= ${opts.from}::date` : undefined,
        opts.to ? sql`${businessMemories.happenedOn} <= ${opts.to}::date` : undefined,
        like
          ? sql`(${businessMemories.body} ilike ${like} or ${businessMemories.subjectLabel} ilike ${like}
                 or ${businessMemories.summary}::text ilike ${like})`
          : undefined,
      ),
    )
    .orderBy(desc(businessMemories.happenedOn), desc(businessMemories.createdAt))
    .limit(opts.limit ?? 100);
  return r.map((m) => ({
    id: m.id,
    kind: m.kind as MemoryKind,
    subjectType: m.subjectType as MemorySubject,
    subjectId: m.subjectId,
    subjectLabel: m.subjectLabel,
    body: m.body,
    summary: m.summary as Explanation | null,
    happenedOn: m.happenedOn,
    source: m.source as MemorySource,
    createdAt: m.createdAt,
  }));
}
