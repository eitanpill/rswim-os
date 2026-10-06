/**
 * Venue Migration Wizard (brief §6.2): when a pool closes or its contract ends, every group there is mapped to a new
 * home, previewed (hard rules, prices, the message each family will get), executed in one transaction and revertible
 * for `migration.revert_hours`.
 *
 * - relocate: the same group moves (venue, pool, lanes, start time on the same weekday). Children, freezes and
 *   cancellations stay on their places; lessons from the date move with the group.
 * - merge: the children join an existing group elsewhere. Their places end on the date and new ones start, and the
 *   source group's lessons from the date are cancelled (reason `venue_migration`, no makeup).
 *
 * Execution writes a snapshot on each item; a revert replays it backwards.
 */
import { z } from 'zod';
import {
  MigrationLeadChoice,
  MigrationMode,
  optionalText,
  requiredDate,
  SEAT_HOLDING_STATUSES,
  TimeOfDay,
  type AdmittedGender,
  type MigrationStatus,
  type StaffGender,
} from '@rswim/contracts';
import { and, asc, eq, gt, gte, inArray, isNull, ne, or, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { studentsByIds } from '@rswim/domain-people';
import { listPrograms, loadPriceResolver, resolvePolicyFor } from '@rswim/domain-settings';
import { listStaff } from '@rswim/domain-staff';
import { getVenue } from '@rswim/domain-venues';
import {
  checkTemplate,
  migrationRevertCheck,
  migrationRulesFrom,
  pickFreeLanes,
  priceChange,
  rankMergeTargets,
  type MergeSuggestion,
  type MigrationGroupFacts,
  type OtherTemplate,
  type PriceChange,
  type RuleIssue,
  type TemplateDraft,
} from '../policies';
import { previewPlacement } from './board';
import { requestShiftChange } from './shifts';
import {
  activeTemplates,
  byIds,
  instructorFacts,
  optionalUuid,
  poolWindows,
  rulesFor,
  todayIL,
} from './shared';

const {
  venueMigrations,
  venueMigrationItems,
  classTemplates,
  classTemplateLanes,
  enrollments,
  sessions,
  sessionStaff,
  shiftChanges,
} = schema;

const issue = (code: string, params: RuleIssue['params'] = {}): RuleIssue => ({
  code: `scheduling.migration.${code}`,
  params,
});

// ─── Inputs ─────────────────────────────────────────────────────────────────

export const MigrationInput = z.object({
  sourceVenueId: z.uuid(),
  effectiveOn: requiredDate(),
  reason: optionalText(300),
});
export type MigrationInput = z.input<typeof MigrationInput>;

export const MigrationItemInput = z
  .object({
    migrationId: z.uuid(),
    sourceTemplateId: z.uuid(),
    mode: MigrationMode,
    targetVenueId: optionalUuid(),
    targetPoolId: optionalUuid(),
    targetStartsAt: z.preprocess((v) => (v === '' ? undefined : v), TimeOfDay.optional()),
    laneIds: z.array(z.uuid()).default([]),
    targetTemplateId: optionalUuid(),
    leadChoice: MigrationLeadChoice.default('keep'),
    newLeadStaffId: optionalUuid(),
  })
  .refine((v) => v.leadChoice !== 'other' || v.newLeadStaffId !== null, {
    message: 'scheduling.migration.errors.leadMissing',
    path: ['newLeadStaffId'],
  })
  .refine(
    (v) =>
      v.mode === 'merge'
        ? v.targetTemplateId !== null
        : v.targetVenueId !== null && v.targetPoolId !== null,
    { message: 'scheduling.migration.errors.targetMissing', path: ['mode'] },
  );
export type MigrationItemInput = z.input<typeof MigrationItemInput>;

/** Hooks other modules supply: lessons with bookings, and places billing already charged (a revert must not undo). */
export interface MigrationDeps {
  /** How many bookings (makeups, trials, marks) hang on these lessons. */
  bookingsInSessions?: (sessionIds: readonly string[]) => Promise<number>;
  /** Which of these places billing has charged. */
  chargedPlaces?: (enrollmentIds: readonly string[]) => Promise<string[]>;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

type MigrationRow = typeof venueMigrations.$inferSelect;
type ItemRow = typeof venueMigrationItems.$inferSelect;
type TemplateRow = typeof classTemplates.$inferSelect;

async function loadMigration(tx: Tx, id: string) {
  const [m] = await tx.select().from(venueMigrations).where(eq(venueMigrations.id, id));
  if (!m) throw new DomainError('common.errors.notFound');
  const items = await tx
    .select()
    .from(venueMigrationItems)
    .where(eq(venueMigrationItems.migrationId, id));
  return { migration: m, items };
}

function requireDraft(m: MigrationRow) {
  if (m.status !== 'draft') throw new DomainError('scheduling.migration.errors.notDraft');
}

const seatOn = (date: string) =>
  and(
    inArray(enrollments.status, [...SEAT_HOLDING_STATUSES]),
    or(isNull(enrollments.endsOn), gt(enrollments.endsOn, date)),
  );

/** The groups that move: active weekly groups at the venue still running on the date. */
async function sourceGroups(tx: Tx, m: Pick<MigrationRow, 'sourceVenueId' | 'effectiveOn'>) {
  return tx
    .select()
    .from(classTemplates)
    .where(
      and(
        eq(classTemplates.venueId, m.sourceVenueId),
        eq(classTemplates.status, 'active'),
        isNull(classTemplates.cohortId),
        or(isNull(classTemplates.effectiveTo), gt(classTemplates.effectiveTo, m.effectiveOn)),
      ),
    )
    .orderBy(asc(classTemplates.weekday), asc(classTemplates.startsAt), asc(classTemplates.name));
}

async function lanesOf(tx: Tx, templateIds: readonly string[]) {
  if (templateIds.length === 0) return new Map<string, string[]>();
  const rows = await tx
    .select()
    .from(classTemplateLanes)
    .where(inArray(classTemplateLanes.classTemplateId, [...templateIds]));
  const out = new Map<string, string[]>();
  for (const r of rows)
    out.set(r.classTemplateId, [...(out.get(r.classTemplateId) ?? []), r.laneId]);
  return out;
}

async function seatsOn(tx: Tx, templateIds: readonly string[], date: string) {
  if (templateIds.length === 0) return [];
  return tx
    .select()
    .from(enrollments)
    .where(and(inArray(enrollments.classTemplateId, [...templateIds]), seatOn(date)));
}

export async function listMigrations(tx: Tx) {
  const r = await tx.execute<{
    id: string;
    sourceVenueId: string;
    venueName: string;
    effectiveOn: string;
    status: MigrationStatus;
    reason: string | null;
    executedAt: Date | null;
    revertUntil: Date | null;
    revertedAt: Date | null;
    groups: number;
  }>(sql`
    select m.id, m.source_venue_id as "sourceVenueId", v.name as "venueName", m.effective_on::text as "effectiveOn",
           m.status, m.reason, m.executed_at as "executedAt", m.revert_until as "revertUntil",
           m.reverted_at as "revertedAt",
           (select count(*)::int from venue_migration_items i where i.migration_id = m.id) as groups
    from venue_migrations m join venues v on v.id = m.source_venue_id
    order by m.created_at desc`);
  return r.rows;
}

// ─── Drafting ───────────────────────────────────────────────────────────────

export async function createMigration(tx: Tx, ctx: ServiceContext, raw: MigrationInput) {
  const input = MigrationInput.parse(raw);
  if (input.effectiveOn < (await todayIL(tx))) {
    throw new DomainError('scheduling.migration.errors.pastDate');
  }
  const [open] = await tx
    .select({ id: venueMigrations.id })
    .from(venueMigrations)
    .where(
      and(
        eq(venueMigrations.sourceVenueId, input.sourceVenueId),
        eq(venueMigrations.status, 'draft'),
      ),
    );
  if (open) throw new DomainError('scheduling.migration.errors.draftExists');
  const [row] = await tx
    .insert(venueMigrations)
    .values({ organizationId: ctx.orgId, ...input, createdBy: ctx.userId })
    .returning({ id: venueMigrations.id });
  return (row as { id: string }).id;
}

export async function deleteMigration(tx: Tx, id: string) {
  const { migration } = await loadMigration(tx, id);
  requireDraft(migration);
  await tx.delete(venueMigrations).where(eq(venueMigrations.id, id));
}

/** Lanes busy in a pool at a slot from a date, by groups other than those listed. */
async function busyLanes(
  tx: Tx,
  poolId: string,
  slot: { weekday: number; startsAt: string; durationMin: number },
  from: string,
  ignore: readonly string[],
) {
  const r = await tx.execute<{ laneId: string }>(sql`
    select l.lane_id as "laneId"
    from class_template_lanes l join class_templates t on t.id = l.class_template_id
    where l.pool_id = ${poolId} and t.status = 'active' and t.weekday = ${slot.weekday}
      and (t.effective_to is null or t.effective_to > ${from}::date)
      and t.starts_at < (${slot.startsAt}::time + make_interval(mins => ${slot.durationMin}))
      and ${slot.startsAt}::time < (t.starts_at + make_interval(mins => t.duration_min))
      ${ignore.length ? sql`and not (t.id = any(${`{${ignore.join(',')}}`}::uuid[]))` : sql``}`);
  return r.rows.map((x) => x.laneId);
}

/** Maps one source group (replacing its earlier mapping). Lanes left empty are picked: the first free ones. */
export async function saveMigrationItem(tx: Tx, ctx: ServiceContext, raw: MigrationItemInput) {
  const input = MigrationItemInput.parse(raw);
  const { migration, items } = await loadMigration(tx, input.migrationId);
  requireDraft(migration);
  const sources = byIds(await sourceGroups(tx, migration));
  const source = sources.get(input.sourceTemplateId);
  if (!source) throw new DomainError('scheduling.migration.errors.notSource');
  let values: Omit<typeof venueMigrationItems.$inferInsert, 'organizationId' | 'migrationId'>;
  if (input.mode === 'merge') {
    const [target] = await tx
      .select()
      .from(classTemplates)
      .where(eq(classTemplates.id, input.targetTemplateId as string));
    if (!target || target.venueId === migration.sourceVenueId || target.status !== 'active') {
      throw new DomainError('scheduling.migration.errors.badTarget');
    }
    values = {
      sourceTemplateId: source.id,
      mode: 'merge',
      targetTemplateId: target.id,
      targetVenueId: null,
      targetPoolId: null,
      targetLaneIds: [],
      targetStartsAt: null,
      leadChoice: 'keep',
      newLeadStaffId: null,
    };
  } else {
    if (input.targetVenueId === migration.sourceVenueId) {
      throw new DomainError('scheduling.migration.errors.badTarget');
    }
    const venue = await getVenue(tx, input.targetVenueId as string);
    const pool = venue?.pools.find((p) => p.id === input.targetPoolId);
    if (!venue || !pool) throw new DomainError('scheduling.migration.errors.badTarget');
    const startsAt = input.targetStartsAt ?? source.startsAt.slice(0, 5);
    let laneIds = input.laneIds.filter((l) => pool.lanes.some((x) => x.id === l));
    if (laneIds.length === 0) {
      const count = (await lanesOf(tx, [source.id])).get(source.id)?.length ?? 1;
      // Lanes other mapped groups will take at the same slot count as busy too.
      const planned = items
        .filter(
          (i) =>
            i.mode === 'relocate' &&
            i.targetPoolId === pool.id &&
            i.sourceTemplateId !== source.id &&
            sources.get(i.sourceTemplateId)?.weekday === source.weekday,
        )
        .flatMap((i) => i.targetLaneIds);
      const busy = await busyLanes(
        tx,
        pool.id,
        { weekday: source.weekday, startsAt, durationMin: source.durationMin },
        migration.effectiveOn,
        [...sources.keys()],
      );
      laneIds = pickFreeLanes(
        pool.lanes.map((l) => l.id),
        [...busy, ...planned],
        count,
      );
      if (laneIds.length === 0) throw new DomainError('scheduling.migration.errors.noLanes');
    }
    values = {
      sourceTemplateId: source.id,
      mode: 'relocate',
      targetVenueId: venue.venue.id,
      targetPoolId: pool.id,
      targetLaneIds: laneIds,
      targetStartsAt: startsAt,
      targetTemplateId: null,
      leadChoice: input.leadChoice,
      newLeadStaffId: input.leadChoice === 'other' ? input.newLeadStaffId : null,
    };
  }
  await tx
    .insert(venueMigrationItems)
    .values({ organizationId: ctx.orgId, migrationId: migration.id, ...values })
    .onConflictDoUpdate({
      target: [venueMigrationItems.migrationId, venueMigrationItems.sourceTemplateId],
      set: values,
    });
}

export async function deleteMigrationItem(tx: Tx, migrationId: string, sourceTemplateId: string) {
  const { migration } = await loadMigration(tx, migrationId);
  requireDraft(migration);
  await tx
    .delete(venueMigrationItems)
    .where(
      and(
        eq(venueMigrationItems.migrationId, migrationId),
        eq(venueMigrationItems.sourceTemplateId, sourceTemplateId),
      ),
    );
}

/** "Everything to venue X at the same times": maps every unmapped group to the venue's first pool. */
export async function relocateAllTo(
  tx: Tx,
  ctx: ServiceContext,
  migrationId: string,
  targetVenueId: string,
) {
  const { migration, items } = await loadMigration(tx, migrationId);
  requireDraft(migration);
  const venue = await getVenue(tx, targetVenueId);
  const pool = venue?.pools[0];
  if (!venue || !pool) throw new DomainError('scheduling.migration.errors.badTarget');
  const mapped = new Set(items.map((i) => i.sourceTemplateId));
  for (const g of await sourceGroups(tx, migration)) {
    if (mapped.has(g.id)) continue;
    await saveMigrationItem(tx, ctx, {
      migrationId,
      sourceTemplateId: g.id,
      mode: 'relocate',
      targetVenueId,
      targetPoolId: pool.id,
      targetStartsAt: g.startsAt.slice(0, 5),
      laneIds: [],
    });
  }
}

// ─── Preview ────────────────────────────────────────────────────────────────

export interface MigrationNotice {
  studentId: string;
  householdId: string;
  firstName: string;
  from: { group: string; venue: string; weekday: number; time: string };
  to: { group: string; venue: string; weekday: number; time: string };
  effectiveOn: string;
  price: PriceChange;
}

export interface MigrationChild {
  studentId: string;
  firstName: string;
  lastName: string;
  householdId: string;
  issues: RuleIssue[];
}

export interface MigrationPreviewGroup {
  source: {
    id: string;
    name: string;
    weekday: number;
    startsAt: string;
    durationMin: number;
    lead: string | null;
    seated: number;
    lanes: number;
  };
  item: {
    mode: 'relocate' | 'merge';
    leadChoice: 'keep' | 'other' | 'none';
    /** Who will lead the group after the move (null: nobody yet). */
    lead: string | null;
    target: {
      venueId: string;
      venueName: string;
      poolName: string | null;
      laneLabels: string[];
      templateId: string | null;
      groupName: string;
      weekday: number;
      startsAt: string;
    };
  } | null;
  suggestions: (MergeSuggestion & {
    name: string;
    venueName: string;
    weekday: number;
    startsAt: string;
    seated: number;
    capacity: number;
  })[];
  issues: RuleIssue[];
  warnings: RuleIssue[];
  children: MigrationChild[];
  price: PriceChange;
  notices: MigrationNotice[];
}

export interface MigrationPreview {
  migration: MigrationRow & { venueName: string };
  groups: MigrationPreviewGroup[];
  /** Venues a group can move to, with their pools. */
  targets: { id: string; name: string; pools: { id: string; name: string }[] }[];
  blockers: number;
  ready: boolean;
  revertable: boolean;
  /** How long an executed migration can be reverted (policy `migration.revert_hours`). */
  revertHours: number;
}

/** Everything the wizard shows. For an executed or reverted migration, what happened (from the snapshots). */
export async function previewMigration(
  tx: Tx,
  migrationId: string,
  deps: MigrationDeps = {},
): Promise<MigrationPreview> {
  const { migration, items } = await loadMigration(tx, migrationId);
  const sourceVenue = await getVenue(tx, migration.sourceVenueId);
  if (!sourceVenue) throw new DomainError('common.errors.notFound');
  const venueRows = (
    await tx.execute<{ id: string; name: string }>(
      sql`select id, name from venues where status = 'active' and id <> ${migration.sourceVenueId} order by name`,
    )
  ).rows;
  const targetVenues = await Promise.all(venueRows.map((v) => getVenue(tx, v.id)));
  const targets = targetVenues.flatMap((v) =>
    v
      ? [
          {
            id: v.venue.id,
            name: v.venue.name,
            pools: v.pools.map((p) => ({ id: p.id, name: p.name })),
          },
        ]
      : [],
  );
  const laneLabel = new Map(
    targetVenues.flatMap((v) =>
      v ? v.pools.flatMap((p) => p.lanes.map((l) => [l.id, l.label] as const)) : [],
    ),
  );
  const poolName = new Map(
    targetVenues.flatMap((v) => (v ? v.pools.map((p) => [p.id, p.name] as const) : [])),
  );
  const venueName = new Map([
    [sourceVenue.venue.id, sourceVenue.venue.name],
    ...targets.map((t) => [t.id, t.name] as const),
  ]);
  const { revertHours } = migrationRulesFrom(
    (await resolvePolicyFor(tx, { date: await todayIL(tx), venueId: migration.sourceVenueId }))
      .rules,
  );
  const revertable = migrationRevertCheck(
    { status: migration.status as MigrationStatus, revertUntil: migration.revertUntil },
    new Date(),
  ).ok;

  if (migration.status !== 'draft') {
    return {
      migration: { ...migration, venueName: sourceVenue.venue.name },
      groups: items.map((i) => (i.snapshot as Snapshot).preview),
      targets,
      blockers: 0,
      revertHours,
      ready: false,
      revertable,
    };
  }

  const sources = await sourceGroups(tx, migration);
  const byItem = new Map(items.map((i) => [i.sourceTemplateId, i]));
  const date = migration.effectiveOn;
  const [programs, staff, all, resolvePrice] = await Promise.all([
    listPrograms(tx),
    listStaff(tx),
    activeTemplates(tx),
    loadPriceResolver(tx),
  ]);
  const staffById = byIds(staff);
  const levels = new Map(programs.flatMap((p) => p.levels.map((l) => [l.id, l.ordinal] as const)));
  const ordinal = (id: string | null) => (id ? (levels.get(id) ?? null) : null);
  const templates = byIds(
    await tx
      .select()
      .from(classTemplates)
      .where(
        inArray(
          classTemplates.id,
          all.map((t) => t.id),
        ),
      ),
  );
  const seats = await seatsOn(
    tx,
    all.map((t) => t.id),
    date,
  );
  const seated = (id: string) => seats.filter((s) => s.classTemplateId === id).length;
  const facts = (t: TemplateRow): MigrationGroupFacts => ({
    id: t.id,
    venueId: t.venueId,
    programId: t.programId,
    weekday: t.weekday,
    startsAt: t.startsAt.slice(0, 5),
    admittedGender: t.admittedGender as AdmittedGender,
    ageMinMonths: t.ageMinMonths,
    ageMaxMonths: t.ageMaxMonths,
    levelMinOrdinal: ordinal(t.levelMinId),
    levelMaxOrdinal: ordinal(t.levelMaxId),
    capacity: t.capacity,
    seated: seated(t.id),
  });
  const candidates = [...templates.values()].filter(
    (t) =>
      t.venueId !== migration.sourceVenueId &&
      t.cohortId === null &&
      (t.effectiveTo === null || t.effectiveTo > date),
  );
  const leadName = (id: string | null) => {
    const s = id ? staffById.get(id) : undefined;
    return s ? `${s.firstName} ${s.lastName}` : null;
  };
  const price = (t: { venueId: string; programId: string; durationMin: number }) =>
    resolvePrice({
      date,
      venueId: t.venueId,
      programId: t.programId,
      kind: 'monthly',
      durationMin: t.durationMin,
    })?.amount ?? null;

  // The timetable as it will be: relocated groups at their new slot, merged groups ending on the date.
  const sourceIds = new Set(sources.map((s) => s.id));
  const drafts = new Map<string, TemplateDraft>();
  for (const s of sources) {
    const i = byItem.get(s.id);
    if (i?.mode !== 'relocate') continue;
    drafts.set(s.id, {
      id: s.id,
      venueId: i.targetVenueId as string,
      poolId: i.targetPoolId as string,
      weekday: s.weekday,
      startsAt: (i.targetStartsAt as string).slice(0, 5),
      durationMin: s.durationMin,
      laneIds: i.targetLaneIds,
      admittedGender: s.admittedGender as AdmittedGender,
      ageMinMonths: s.ageMinMonths,
      effectiveFrom: date,
      effectiveTo: s.effectiveTo,
      requiredInstructorGender: s.requiredInstructorGender as StaffGender | null,
      requiredSkills: s.requiredSkills,
      leadStaffId: s.leadStaffId,
    });
  }
  const others: OtherTemplate[] = all.map((t) => {
    if (!sourceIds.has(t.id)) return t;
    const d = drafts.get(t.id);
    if (d) return { ...t, ...d, id: t.id, name: t.name, effectiveFrom: date };
    return { ...t, effectiveTo: date };
  });

  const groups: MigrationPreviewGroup[] = [];
  for (const s of sources) {
    const i = byItem.get(s.id) ?? null;
    const sFacts = facts(s);
    const suggestions = rankMergeTargets(sFacts, candidates.map(facts))
      .slice(0, 3)
      .map((sg) => {
        const t = templates.get(sg.id) as TemplateRow;
        return {
          ...sg,
          name: t.name,
          venueName: venueName.get(t.venueId) ?? '',
          weekday: t.weekday,
          startsAt: t.startsAt.slice(0, 5),
          seated: seated(t.id),
          capacity: t.capacity,
        };
      });
    const mySeats = seats.filter((e) => e.classTemplateId === s.id);
    const people = byIds(
      await studentsByIds(
        tx,
        mySeats.map((e) => e.studentId),
      ),
    );
    const children: MigrationChild[] = mySeats.flatMap((e) => {
      const p = people.get(e.studentId);
      return p
        ? [
            {
              studentId: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              householdId: p.householdId,
              issues: [],
            },
          ]
        : [];
    });
    const issues: RuleIssue[] = [];
    const warnings: RuleIssue[] = [];
    let item: MigrationPreviewGroup['item'] = null;
    let after: { venueId: string; programId: string; durationMin: number } | null = null;
    let to: MigrationNotice['to'] | null = null;
    if (!i) {
      issues.push(issue('unmapped'));
    } else if (i.mode === 'relocate') {
      const draft = drafts.get(s.id) as TemplateDraft;
      const rules = await rulesFor(tx, {
        date,
        venueId: draft.venueId,
        programId: s.programId,
        classTemplateId: s.id,
      });
      const leadId =
        i.leadChoice === 'keep'
          ? s.leadStaffId
          : i.leadChoice === 'other'
            ? i.newLeadStaffId
            : null;
      const lead = leadId ? await instructorFacts(tx, leadId) : null;
      const check = checkTemplate(
        { ...draft, leadStaffId: leadId },
        await poolWindows(tx, draft.poolId),
        others,
        lead,
        rules.scheduling,
      );
      if (!leadId && s.leadStaffId) warnings.push(issue('noLeadYet'));
      issues.push(...check.violations);
      warnings.push(...check.warnings);
      const vName = venueName.get(draft.venueId) ?? '';
      item = {
        mode: 'relocate',
        leadChoice: i.leadChoice as 'keep' | 'other' | 'none',
        lead: leadName(leadId),
        target: {
          venueId: draft.venueId,
          venueName: vName,
          poolName: poolName.get(draft.poolId) ?? null,
          laneLabels: draft.laneIds.map((l) => laneLabel.get(l) ?? ''),
          templateId: null,
          groupName: s.name,
          weekday: s.weekday,
          startsAt: draft.startsAt,
        },
      };
      after = { venueId: draft.venueId, programId: s.programId, durationMin: s.durationMin };
      to = { group: s.name, venue: vName, weekday: s.weekday, time: draft.startsAt };
    } else {
      const t = templates.get(i.targetTemplateId as string);
      if (!t || (t.effectiveTo !== null && t.effectiveTo <= date)) {
        issues.push(issue('targetGone'));
      } else {
        const free = t.capacity - seated(t.id);
        if (free < children.length) issues.push(issue('noRoom', { free, needed: children.length }));
        for (const c of children) {
          const e = mySeats.find((x) => x.studentId === c.studentId) as (typeof mySeats)[number];
          if (e.status === 'frozen') c.issues.push(issue('frozen'));
          else if (e.status === 'trial_booked') c.issues.push(issue('trialBooked'));
          else if (e.endsOn !== null) c.issues.push(issue('leaving'));
          else {
            const p = await previewPlacement(tx, {
              studentId: c.studentId,
              toTemplateId: t.id,
              fromTemplateId: s.id,
              onDate: date,
              status: 'active',
            });
            // Capacity is checked for the whole group above; the rest is per child.
            c.issues.push(...p.decision.violations.filter((v) => !v.code.endsWith('.full')));
          }
        }
        if (deps.bookingsInSessions) {
          const ahead = await tx
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              and(
                eq(sessions.classTemplateId, s.id),
                gte(sessions.date, date),
                eq(sessions.status, 'scheduled'),
              ),
            );
          const booked = ahead.length ? await deps.bookingsInSessions(ahead.map((x) => x.id)) : 0;
          if (booked > 0) issues.push(issue('bookedLessons', { count: booked }));
        }
        const vName = venueName.get(t.venueId) ?? '';
        item = {
          mode: 'merge',
          leadChoice: 'keep',
          lead: leadName(t.leadStaffId),
          target: {
            venueId: t.venueId,
            venueName: vName,
            poolName: null,
            laneLabels: [],
            templateId: t.id,
            groupName: t.name,
            weekday: t.weekday,
            startsAt: t.startsAt.slice(0, 5),
          },
        };
        after = t;
        to = { group: t.name, venue: vName, weekday: t.weekday, time: t.startsAt.slice(0, 5) };
      }
    }
    const change = priceChange(price(s), after ? price(after) : null);
    const from = {
      group: s.name,
      venue: sourceVenue.venue.name,
      weekday: s.weekday,
      time: s.startsAt.slice(0, 5),
    };
    groups.push({
      source: {
        id: s.id,
        name: s.name,
        weekday: s.weekday,
        startsAt: s.startsAt.slice(0, 5),
        durationMin: s.durationMin,
        lead: leadName(s.leadStaffId),
        seated: children.length,
        lanes: (await lanesOf(tx, [s.id])).get(s.id)?.length ?? 0,
      },
      item,
      suggestions,
      issues,
      warnings,
      children,
      price: change,
      notices: to
        ? children.map((c) => ({
            studentId: c.studentId,
            householdId: c.householdId,
            firstName: c.firstName,
            from,
            to: to as MigrationNotice['to'],
            effectiveOn: date,
            price: change,
          }))
        : [],
    });
  }
  const blockers = groups.reduce(
    (n, g) => n + g.issues.length + g.children.reduce((m, c) => m + c.issues.length, 0),
    0,
  );
  return {
    migration: { ...migration, venueName: sourceVenue.venue.name },
    groups,
    targets,
    blockers,
    ready: groups.length > 0 && blockers === 0,
    revertable,
    revertHours,
  };
}

/** The personal messages a migration sends (or sent): one per child, from the preview or the executed snapshot. */
export async function migrationNotices(tx: Tx, migrationId: string): Promise<MigrationNotice[]> {
  const p = await previewMigration(tx, migrationId);
  return p.groups.flatMap((g) => g.notices);
}

// ─── Execute and revert ─────────────────────────────────────────────────────

interface Snapshot {
  preview: MigrationPreviewGroup;
  template: {
    venueId: string;
    poolId: string;
    startsAt: string;
    laneIds: string[];
    effectiveTo: string | null;
  };
  /** relocate: the lessons that moved, as they were. */
  sessions: { id: string; venueId: string; startsAt: string; endsAt: string }[];
  /** relocate with a new lead or none: the lead and the lessons' lead rows as they were, and the shift change asked. */
  lead: {
    leadStaffId: string | null;
    rows: { sessionId: string; staffMemberId: string }[];
    shiftChangeId: string | null;
  } | null;
  /** merge: the lessons cancelled. */
  cancelledSessionIds: string[];
  /** merge: each child's old place (as it was) and the new one. */
  places: {
    old: typeof enrollments.$inferSelect;
    deleted: boolean;
    newId: string;
  }[];
}

/** Applies a ready migration in one transaction, opens its revert window and tells the families. */
export async function executeMigration(
  tx: Tx,
  ctx: ServiceContext,
  migrationId: string,
  deps: MigrationDeps = {},
) {
  const preview = await previewMigration(tx, migrationId, deps);
  const m = preview.migration;
  requireDraft(m);
  if (!preview.ready) throw new DomainError('scheduling.migration.errors.notReady');
  const date = m.effectiveOn;
  const { items } = await loadMigration(tx, migrationId);
  const byItem = new Map(items.map((i) => [i.sourceTemplateId, i]));
  const resolved = await resolvePolicyFor(tx, {
    date: await todayIL(tx),
    venueId: m.sourceVenueId,
  });
  const rules = migrationRulesFrom(resolved.rules);

  for (const g of preview.groups) {
    const item = byItem.get(g.source.id) as ItemRow;
    const [t] = await tx.select().from(classTemplates).where(eq(classTemplates.id, g.source.id));
    const template = t as TemplateRow;
    const snapshot: Snapshot = {
      preview: g,
      template: {
        venueId: template.venueId,
        poolId: template.poolId,
        startsAt: template.startsAt.slice(0, 5),
        laneIds: (await lanesOf(tx, [template.id])).get(template.id) ?? [],
        effectiveTo: template.effectiveTo,
      },
      sessions: [],
      lead: null,
      cancelledSessionIds: [],
      places: [],
    };
    if (item.mode === 'relocate') {
      const startsAt = (item.targetStartsAt as string).slice(0, 5);
      const moved = await tx.execute<{
        id: string;
        venueId: string;
        startsAt: string;
        endsAt: string;
      }>(sql`
        select id, venue_id as "venueId", starts_at::text as "startsAt", ends_at::text as "endsAt"
        from sessions where class_template_id = ${template.id} and date >= ${date}::date`);
      snapshot.sessions = moved.rows;
      await tx
        .delete(classTemplateLanes)
        .where(eq(classTemplateLanes.classTemplateId, template.id));
      await tx
        .update(classTemplates)
        .set({
          venueId: item.targetVenueId as string,
          poolId: item.targetPoolId as string,
          startsAt,
        })
        .where(eq(classTemplates.id, template.id));
      await tx.insert(classTemplateLanes).values(
        item.targetLaneIds.map((laneId) => ({
          organizationId: ctx.orgId,
          poolId: item.targetPoolId as string,
          classTemplateId: template.id,
          laneId,
        })),
      );
      await tx.execute(sql`
        update sessions set venue_id = ${item.targetVenueId},
          starts_at = ((date + ${startsAt}::time) at time zone 'Asia/Jerusalem'),
          ends_at = ((date + ${startsAt}::time + make_interval(mins => ${template.durationMin})) at time zone 'Asia/Jerusalem')
        where class_template_id = ${template.id} and date >= ${date}::date`);
      if (item.leadChoice !== 'keep' && template.leadStaffId) {
        const ahead = snapshot.sessions.map((x) => x.id);
        const rows = ahead.length
          ? await tx
              .delete(sessionStaff)
              .where(and(inArray(sessionStaff.sessionId, ahead), eq(sessionStaff.role, 'lead')))
              .returning({
                sessionId: sessionStaff.sessionId,
                staffMemberId: sessionStaff.staffMemberId,
              })
          : [];
        await tx
          .update(classTemplates)
          .set({ leadStaffId: null })
          .where(eq(classTemplates.id, template.id));
        snapshot.lead = { leadStaffId: template.leadStaffId, rows, shiftChangeId: null };
      }
      if (item.leadChoice === 'other' && item.newLeadStaffId) {
        const change = await requestShiftChange(tx, ctx, {
          kind: 'reassign_group',
          classTemplateId: template.id,
          effectiveFrom: date,
          toStaffId: item.newLeadStaffId,
          reason: 'venue_migration',
        });
        snapshot.lead = {
          leadStaffId: snapshot.lead?.leadStaffId ?? template.leadStaffId,
          rows: snapshot.lead?.rows ?? [],
          shiftChangeId: change.id,
        };
      }
    } else {
      const targetId = item.targetTemplateId as string;
      const places = await tx
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.classTemplateId, template.id), seatOn(date)));
      for (const old of places) {
        const deleted = old.startsOn >= date;
        if (deleted) {
          await tx.delete(enrollments).where(eq(enrollments.id, old.id));
        } else {
          await tx
            .update(enrollments)
            .set({ endsOn: date, status: 'completed' })
            .where(eq(enrollments.id, old.id));
        }
        const [row] = await tx
          .insert(enrollments)
          .values({
            organizationId: ctx.orgId,
            studentId: old.studentId,
            classTemplateId: targetId,
            status: old.status,
            startsOn: deleted ? old.startsOn : date,
            previousEnrollmentId: deleted ? old.previousEnrollmentId : old.id,
            source: 'venue_migration',
            createdBy: ctx.userId,
          })
          .returning({ id: enrollments.id });
        snapshot.places.push({ old, deleted, newId: (row as { id: string }).id });
      }
      const cancelled = await tx
        .update(sessions)
        .set({ status: 'cancelled_by_school', cancelReason: 'venue_migration' })
        .where(
          and(
            eq(sessions.classTemplateId, template.id),
            gte(sessions.date, date),
            eq(sessions.status, 'scheduled'),
          ),
        )
        .returning({ id: sessions.id });
      snapshot.cancelledSessionIds = cancelled.map((c) => c.id);
      await tx
        .update(classTemplates)
        .set({ effectiveTo: date })
        .where(eq(classTemplates.id, template.id));
    }
    await tx
      .update(venueMigrationItems)
      .set({ snapshot })
      .where(eq(venueMigrationItems.id, item.id));
  }

  const [done] = await tx
    .update(venueMigrations)
    .set({
      status: 'executed',
      executedAt: sql`now()`,
      executedBy: ctx.userId,
      revertUntil: sql`now() + make_interval(hours => ${rules.revertHours})`,
      policyVersionKey: resolved.versionKey,
    })
    .where(and(eq(venueMigrations.id, migrationId), eq(venueMigrations.status, 'draft')))
    .returning({ id: venueMigrations.id });
  if (!done) throw new DomainError('scheduling.migration.errors.notDraft');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.venue_migrated',
    payload: { migrationId, sourceVenueId: m.sourceVenueId, effectiveOn: date },
    idempotencyKey: `scheduling.venue_migrated:${migrationId}`,
  });
  return {
    groups: preview.groups.length,
    children: preview.groups.reduce((n, g) => n + g.children.length, 0),
  };
}

/** Puts everything back as it was, inside the revert window, and tells the families the change is off. */
export async function revertMigration(
  tx: Tx,
  ctx: ServiceContext,
  migrationId: string,
  deps: MigrationDeps = {},
) {
  const { migration, items } = await loadMigration(tx, migrationId);
  const now = new Date(
    ((await tx.execute<{ now: string }>(sql`select now()::text as now`)).rows[0] as { now: string })
      .now,
  );
  const check = migrationRevertCheck(
    { status: migration.status as MigrationStatus, revertUntil: migration.revertUntil },
    now,
  );
  if (!check.ok) throw new DomainError(check.code);
  const snapshots = items.map((i) => ({ item: i, s: i.snapshot as Snapshot }));
  const newPlaces = snapshots.flatMap(({ s }) => s.places.map((p) => p.newId));
  if (deps.chargedPlaces && newPlaces.length) {
    const charged = await deps.chargedPlaces(newPlaces);
    if (charged.length) throw new DomainError('scheduling.migration.errors.billed');
  }
  for (const { item, s } of snapshots) {
    const id = item.sourceTemplateId;
    if (item.mode === 'relocate') {
      await tx.delete(classTemplateLanes).where(eq(classTemplateLanes.classTemplateId, id));
      await tx
        .update(classTemplates)
        .set({
          venueId: s.template.venueId,
          poolId: s.template.poolId,
          startsAt: s.template.startsAt,
        })
        .where(eq(classTemplates.id, id));
      if (s.template.laneIds.length) {
        await tx.insert(classTemplateLanes).values(
          s.template.laneIds.map((laneId) => ({
            organizationId: ctx.orgId,
            poolId: s.template.poolId,
            classTemplateId: id,
            laneId,
          })),
        );
      }
      for (const x of s.sessions) {
        await tx.execute(sql`
          update sessions set venue_id = ${x.venueId}, starts_at = ${x.startsAt}::timestamptz,
                 ends_at = ${x.endsAt}::timestamptz
          where id = ${x.id}`);
      }
      if (s.lead) {
        if (s.lead.shiftChangeId) {
          await tx
            .update(shiftChanges)
            .set({ status: 'cancelled' })
            .where(
              and(
                eq(shiftChanges.id, s.lead.shiftChangeId),
                inArray(shiftChanges.status, ['pending', 'accepted', 'escalated']),
              ),
            );
        }
        const ahead = s.sessions.map((x) => x.id);
        if (ahead.length) {
          await tx
            .delete(sessionStaff)
            .where(and(inArray(sessionStaff.sessionId, ahead), eq(sessionStaff.role, 'lead')));
        }
        if (s.lead.rows.length) {
          await tx
            .insert(sessionStaff)
            .values(s.lead.rows.map((r) => ({ organizationId: ctx.orgId, ...r, role: 'lead' })));
        }
        await tx
          .update(classTemplates)
          .set({ leadStaffId: s.lead.leadStaffId })
          .where(eq(classTemplates.id, id));
      }
    } else {
      if (s.places.length) {
        await tx.delete(enrollments).where(
          inArray(
            enrollments.id,
            s.places.map((p) => p.newId),
          ),
        );
      }
      for (const p of s.places) {
        if (p.deleted) {
          await tx.insert(enrollments).values({
            ...p.old,
            createdAt: new Date(p.old.createdAt),
            updatedAt: new Date(p.old.updatedAt),
          });
        } else {
          await tx
            .update(enrollments)
            .set({ endsOn: p.old.endsOn, status: p.old.status })
            .where(eq(enrollments.id, p.old.id));
        }
      }
      if (s.cancelledSessionIds.length) {
        await tx
          .update(sessions)
          .set({ status: 'scheduled', cancelReason: null })
          .where(
            and(
              inArray(sessions.id, s.cancelledSessionIds),
              eq(sessions.cancelReason, 'venue_migration'),
            ),
          );
      }
      await tx
        .update(classTemplates)
        .set({ effectiveTo: s.template.effectiveTo })
        .where(eq(classTemplates.id, id));
    }
  }
  await tx
    .update(venueMigrations)
    .set({ status: 'reverted', revertedAt: sql`now()`, revertedBy: ctx.userId })
    .where(and(eq(venueMigrations.id, migrationId), ne(venueMigrations.status, 'reverted')));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'scheduling.venue_migration_reverted',
    payload: { migrationId },
    idempotencyKey: `scheduling.venue_migration_reverted:${migrationId}`,
  });
}
