/**
 * Importing a file (SaaS stage 5): the owner uploads a file, the system guesses which column is which (the owner fixes
 * it), shows what will come in and what is wrong, saves it in one transaction, and can take it back within a day.
 * Families can then be asked to sign a new standing order by a personal link.
 *
 * An import lives in `import_runs` (provider 'file'): a draft holds the file's table and the mapping; a saved one
 * holds what it created. The office (owner, admins) is the only role that reads or writes it (RLS).
 */
import { z } from 'zod';
import {
  IMPORT_UNDO_HOURS,
  ImportKind,
  normalizeHeader,
  type ImportMapping,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { openCheckout, postEntry } from '@rswim/domain-billing';
import { DomainError, emit, toDomainError, type ServiceContext } from '@rswim/domain-core';
import { addDiver } from '@rswim/domain-dive';
import { addStudent, createHousehold, addGuardian } from '@rswim/domain-people';
import { placeStudent, todayIL } from '@rswim/domain-scheduling';
import { createStaff } from '@rswim/domain-staff';
import type { Table } from './parse';
import {
  canUndo,
  cleanMapping,
  guessMapping,
  missingFields,
  planImport,
  type ImportContext,
  type ImportPlan,
  type Issue,
} from './policies';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

export interface ImportCreated {
  households?: string[];
  students?: string[];
  divers?: string[];
  staff?: string[];
}

export interface ImportRun {
  id: string;
  kind: ImportKind;
  status: string;
  fileName: string | null;
  headers: string[];
  rows: string[][];
  mapping: ImportMapping;
  stats: Record<string, number>;
  report: Issue[];
  created: ImportCreated;
  startedAt: Date;
  committedAt: Date | null;
  undoneAt: Date | null;
  canUndo: boolean;
}

interface RunRow {
  id: string;
  kind: string;
  status: string;
  fileName: string | null;
  source: { headers?: string[]; rows?: string[][] } | null;
  mapping: Record<string, string>;
  stats: Record<string, number>;
  report: Issue[];
  created: ImportCreated;
  startedAt: string | Date;
  committedAt: string | Date | null;
  undoneAt: string | Date | null;
  now: string | Date;
}

const date = (v: string | Date | null) => (v === null ? null : new Date(v));

function toRun(r: RunRow): ImportRun {
  const kind = ImportKind.parse(r.kind);
  const headers = r.source?.headers ?? [];
  const committedAt = date(r.committedAt);
  return {
    id: r.id,
    kind,
    status: r.status,
    fileName: r.fileName,
    headers,
    rows: r.source?.rows ?? [],
    mapping: cleanMapping(kind, headers.length, r.mapping ?? {}),
    stats: r.stats ?? {},
    report: Array.isArray(r.report) ? r.report : [],
    created: r.created ?? {},
    startedAt: new Date(r.startedAt),
    committedAt,
    undoneAt: date(r.undoneAt),
    canUndo: r.status === 'succeeded' && canUndo(committedAt, new Date(r.now), IMPORT_UNDO_HOURS),
  };
}

const RUN_COLUMNS = sql`id, kind, status, file_name "fileName", source, mapping, stats, report, created,
  created_at "startedAt", committed_at "committedAt", undone_at "undoneAt", now() as now`;

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The business's file imports, newest first. */
export async function listImports(tx: Tx, limit = 20): Promise<ImportRun[]> {
  const r = await rows<RunRow>(
    tx,
    sql`select ${RUN_COLUMNS} from import_runs where provider = 'file' and status <> 'draft'
        order by created_at desc limit ${limit}`,
  );
  return r.map(toRun);
}

export async function getImport(tx: Tx, id: string): Promise<ImportRun | null> {
  const [r] = await rows<RunRow>(
    tx,
    sql`select ${RUN_COLUMNS} from import_runs where id = ${id} and provider = 'file'`,
  );
  return r ? toRun(r) : null;
}

/** What already exists that a row must not repeat or may point at: phones, levels and groups by name. */
export async function importContext(tx: Tx, kind: ImportKind): Promise<ImportContext> {
  const phoneSql =
    kind === 'families'
      ? sql`select phone_e164 p from guardians where phone_e164 is not null`
      : kind === 'divers'
        ? sql`select phone_e164 p from dive_divers where phone_e164 is not null`
        : sql`select phone_e164 p from staff_members where phone_e164 is not null`;
  const [phones, levels, groups, today] = await Promise.all([
    rows<{ p: string }>(tx, phoneSql),
    kind === 'families'
      ? rows<{ id: string; name: string; code: string }>(
          tx,
          sql`select id, name_he as name, code from levels order by ordinal`,
        )
      : Promise.resolve([]),
    kind === 'families'
      ? rows<{ id: string; name: string }>(
          tx,
          sql`select id, name from class_templates where status = 'active' order by name`,
        )
      : Promise.resolve([]),
    todayIL(tx),
  ]);
  const levelMap = new Map<string, string>();
  for (const l of levels) {
    // The first level of a name wins (two programs may both have "שלב 1"); the code works too.
    if (!levelMap.has(normalizeHeader(l.name))) levelMap.set(normalizeHeader(l.name), l.id);
    if (!levelMap.has(normalizeHeader(l.code))) levelMap.set(normalizeHeader(l.code), l.id);
  }
  return {
    phones: new Set(phones.map((p) => p.p)),
    levels: levelMap,
    groups: new Map(groups.map((g) => [normalizeHeader(g.name), g.id])),
    today,
  };
}

/** The draft's plan as the preview shows it (nothing is saved). */
export async function previewImport(tx: Tx, id: string) {
  const run = await getImport(tx, id);
  if (!run || run.status !== 'draft') throw new DomainError('common.errors.notFound');
  const plan = planImport(run.kind, run.rows, run.mapping, await importContext(tx, run.kind));
  return { run, plan, missing: missingFields(run.kind, run.mapping) };
}

// ─── Draft ──────────────────────────────────────────────────────────────────

/**
 * Keeps an uploaded table as a draft with the rules' guess at its columns, or a better one (Claude's, merged by the
 * caller). Drafts nobody finished within a week are dropped with their rows.
 */
export async function createImportDraft(
  tx: Tx,
  ctx: ServiceContext,
  input: { kind: ImportKind; fileName: string; table: Table; mapping?: ImportMapping },
): Promise<string> {
  await tx.execute(
    sql`update import_runs set status = 'failed', error = 'abandoned', source = null, finished_at = now()
        where provider = 'file' and status = 'draft' and created_at < now() - interval '7 days'`,
  );
  const mapping = input.mapping ?? guessMapping(input.kind, input.table.headers);
  const [r] = await guarded(() =>
    rows<{ id: string }>(
      tx,
      sql`insert into import_runs (organization_id, provider, kind, status, file_name, source, mapping, created_by)
          values (${ctx.orgId}, 'file', ${input.kind}, 'draft', ${input.fileName.slice(0, 200)},
                  ${JSON.stringify(input.table)}::jsonb, ${JSON.stringify(mapping)}::jsonb, ${ctx.userId})
          returning id`,
    ),
  );
  return (r as { id: string }).id;
}

export const MappingInput = z
  .object({ importId: z.uuid() })
  .catchall(z.string())
  .transform(({ importId, ...rest }) => ({
    importId,
    columns: Object.fromEntries(
      Object.entries(rest)
        .filter(([k]) => /^col_\d+$/.test(k))
        .map(([k, v]) => [k.slice(4), v]),
    ),
  }));
export type MappingInput = z.output<typeof MappingInput>;

/** The owner's corrections to which column is which. */
export async function saveMapping(tx: Tx, input: MappingInput): Promise<void> {
  const run = await getImport(tx, input.importId);
  if (!run || run.status !== 'draft') throw new DomainError('common.errors.notFound');
  const mapping = cleanMapping(run.kind, run.headers.length, input.columns);
  await tx.execute(
    sql`update import_runs set mapping = ${JSON.stringify(mapping)}::jsonb where id = ${run.id}`,
  );
}

/** Drops a draft and the rows it held. */
export async function discardImport(tx: Tx, id: string): Promise<void> {
  await tx.execute(
    sql`update import_runs set status = 'failed', error = 'discarded', source = null, finished_at = now()
        where id = ${id} and provider = 'file' and status = 'draft'`,
  );
}

// ─── Saving ─────────────────────────────────────────────────────────────────

export const CommitInput = z.object({
  importId: z.uuid(),
  /** The families agreed to hear from the business on WhatsApp (they are its customers already). */
  whatsappOptIn: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});
export type CommitInput = z.infer<typeof CommitInput>;

async function commitFamilies(
  tx: Tx,
  ctx: ServiceContext,
  plan: ImportPlan,
  opts: { optIn: boolean; runId: string; balanceDescription: string },
) {
  const { optIn, runId } = opts;
  const created: Required<Pick<ImportCreated, 'households' | 'students'>> = {
    households: [],
    students: [],
  };
  const extra: Issue[] = [];
  let placed = 0;
  const today = await todayIL(tx);
  for (const fam of plan.families) {
    const { householdId } = await guarded(() =>
      createHousehold(
        tx,
        ctx,
        { displayName: fam.displayName, preferredLocale: 'he', notes: fam.notes },
        {
          firstName: fam.parent.firstName,
          lastName: fam.parent.lastName,
          phoneE164: fam.parent.phone,
          email: fam.parent.email,
          relation: null,
          whatsappOptIn: optIn && Boolean(fam.parent.phone),
          isBillingContact: true,
        },
      ),
    );
    created.households.push(householdId);
    const p2 = fam.parent2;
    if (p2) {
      await guarded(() =>
        addGuardian(tx, ctx, householdId, {
          firstName: p2.firstName,
          lastName: p2.lastName,
          phoneE164: p2.phone,
          email: null,
          relation: null,
          whatsappOptIn: optIn && Boolean(p2.phone),
          isBillingContact: false,
        }),
      );
    }
    for (const child of fam.children) {
      const studentId = await guarded(() =>
        addStudent(tx, ctx, householdId, {
          firstName: child.firstName,
          lastName: child.lastName,
          dob: child.dob,
          gender: child.gender,
          school: null,
          grade: null,
          levelId: child.levelId,
          preferredStaffId: null,
          waterFear: false,
          photoConsent: true,
          isSelfGuardian: false,
          requiresFemaleInstructor: false,
          custodyPattern: null,
        }),
      );
      created.students.push(studentId);
      if (!child.groupId) continue;
      // A group that is full or does not fit the child (age, level) is reported; the child still comes in.
      try {
        await tx.transaction((sp) =>
          placeStudent(sp as unknown as Tx, ctx, {
            studentId,
            toTemplateId: child.groupId as string,
            fromTemplateId: null,
            onDate: today,
            status: 'active',
          }),
        );
        placed++;
      } catch (e) {
        const de = toDomainError(e);
        if (!de) throw e;
        extra.push({
          row: child.row,
          code: 'notPlaced',
          severity: 'warning',
          value: `${child.groupName ?? ''}|${de.code}`,
        });
      }
    }
    if (fam.balanceAgorot !== 0) {
      await postEntry(tx, ctx, {
        householdId,
        type: 'adjustment',
        amountAgorot: fam.balanceAgorot,
        description: opts.balanceDescription,
        source: 'import',
        idempotencyKey: `import:${runId}:${householdId}`,
        note: `row ${fam.rows.join(',')}`,
      });
    }
  }
  return { created, extra, stats: { placed } };
}

async function commitPeople(tx: Tx, ctx: ServiceContext, plan: ImportPlan) {
  const ids: string[] = [];
  for (const p of plan.people) {
    if (plan.kind === 'divers') {
      ids.push(
        await addDiver(tx, ctx, {
          firstName: p.firstName,
          lastName: p.lastName,
          phoneE164: p.phone,
          email: p.email,
          dob: p.dob,
          gender: p.gender,
          certLevel: p.certLevel,
          certAgency: p.certAgency,
          certNumber: p.certNumber,
          city: p.city,
          emergencyName: p.emergencyName,
          emergencyPhone: p.emergencyPhone,
          notes: p.notes,
          source: 'import',
        }),
      );
    } else {
      ids.push(
        await guarded(() =>
          createStaff(tx, ctx, {
            firstName: p.firstName,
            lastName: p.lastName,
            phoneE164: p.phone,
            email: p.email,
            gender: p.gender,
            employmentType: p.employmentType,
            startDate: p.startDate,
            endDate: null,
            status: 'active',
            skills: [],
            notes: p.notes,
          }),
        ),
      );
    }
  }
  return plan.kind === 'divers' ? { divers: ids } : { staff: ids };
}

/**
 * Saves a draft: every row without an error becomes a family (with its children, groups and balance), a diver or a
 * team member, all in the caller's transaction, so a plan limit or any failure saves nothing. The file's rows are
 * then dropped; the counts and the problems found stay with the import.
 */
export async function commitImport(
  tx: Tx,
  ctx: ServiceContext,
  input: CommitInput,
  texts: { balanceDescription: string },
) {
  const { run, plan, missing } = await previewImport(tx, input.importId);
  if (missing.length) throw new DomainError('imports.errors.mapping');
  if (plan.records === 0) throw new DomainError('imports.errors.nothing');
  const started = Date.now();
  let created: ImportCreated;
  let report: Issue[] = plan.issues;
  let stats: Record<string, number> = {
    rows: plan.rows,
    ready: plan.ready,
    skipped: plan.skipped,
    records: plan.records,
    children: plan.children,
    balanceAgorot: plan.balanceAgorot,
  };
  if (run.kind === 'families') {
    const r = await commitFamilies(tx, ctx, plan, {
      optIn: input.whatsappOptIn,
      runId: run.id,
      balanceDescription: texts.balanceDescription,
    });
    created = r.created;
    report = [...report, ...r.extra].sort((a, b) => a.row - b.row);
    stats = { ...stats, ...r.stats, notPlaced: r.extra.length };
  } else {
    created = await commitPeople(tx, ctx, plan);
  }
  stats.ms = Date.now() - started;
  await tx.execute(
    sql`update import_runs set status = 'succeeded', committed_at = now(), finished_at = now(),
               source = jsonb_build_object('headers', source -> 'headers'),
               stats = ${JSON.stringify(stats)}::jsonb, report = ${JSON.stringify(report)}::jsonb,
               created = ${JSON.stringify(created)}::jsonb
        where id = ${run.id}`,
  );
  return { importId: run.id, records: plan.records, children: plan.children };
}

// ─── Taking it back ─────────────────────────────────────────────────────────

/** Deletes one row in a savepoint when nothing else points at it; false when it is in use (or cannot go). */
async function removeIfUnused(
  tx: Tx,
  table: 'households' | 'dive_divers' | 'staff_members',
  id: string,
  ignore: string[],
  extraCheck?: ReturnType<typeof sql>,
): Promise<boolean> {
  const [used] = await rows<{ used: boolean }>(
    tx,
    sql`select app.referenced_elsewhere(${table}::regclass, ${id}::uuid, ${`{${ignore.join(',')}}`}::text[])
          ${extraCheck ? sql`or ${extraCheck}` : sql``} as used`,
  );
  if (used?.used) return false;
  try {
    await tx.transaction(async (sp) => {
      await sp.execute(sql`delete from ${sql.identifier(table)} where id = ${id}`);
    });
    return true;
  } catch (e) {
    if (toDomainError(e)) return false;
    throw e;
  }
}

/**
 * Takes a saved import back within a day: removes what it created, except what was used since (a family with a
 * payment, a lesson or a signed standing order, a diver with a booking, a team member on the schedule), and reports
 * how many stayed.
 */
export async function undoImport(tx: Tx, importId: string) {
  const run = await getImport(tx, importId);
  if (!run) throw new DomainError('common.errors.notFound');
  if (!run.canUndo) throw new DomainError('imports.errors.undoClosed');
  let removed = 0;
  let kept = 0;
  const count = (ok: boolean) => (ok ? removed++ : kept++);
  for (const id of run.created.households ?? []) {
    const studentsUsed = sql`exists (
      select 1 from students s where s.household_id = ${id}::uuid
        and app.referenced_elsewhere('students'::regclass, s.id, '{enrollments,student_relations}'::text[]))
      or exists (select 1 from guardians g where g.household_id = ${id}::uuid
        and app.referenced_elsewhere('guardians'::regclass, g.id, '{messages}'::text[]))
      or exists (select 1 from ledger_entries l where l.household_id = ${id}::uuid and l.source <> 'import')`;
    count(
      await removeIfUnused(
        tx,
        'households',
        id,
        ['guardians', 'students', 'ledger_entries', 'checkouts', 'messages'],
        studentsUsed,
      ),
    );
  }
  for (const id of run.created.divers ?? []) count(await removeIfUnused(tx, 'dive_divers', id, []));
  for (const id of run.created.staff ?? [])
    count(await removeIfUnused(tx, 'staff_members', id, []));
  await tx.execute(
    sql`update import_runs set status = 'undone', undone_at = now(),
               stats = stats || ${JSON.stringify({ removed, kept })}::jsonb
        where id = ${run.id}`,
  );
  return { removed, kept };
}

// ─── Standing orders ────────────────────────────────────────────────────────

export interface MandateRow {
  householdId: string;
  name: string;
  phone: string | null;
  state: 'signed' | 'sent' | 'none';
}

/** The families an import brought in, and whether each has signed a new standing order, was sent a link, or neither. */
export async function importMandates(tx: Tx, importId: string): Promise<MandateRow[]> {
  const run = await getImport(tx, importId);
  if (!run || run.kind !== 'families' || run.status !== 'succeeded') return [];
  const ids = run.created.households ?? [];
  if (ids.length === 0) return [];
  return rows<MandateRow>(
    tx,
    sql`select h.id "householdId", h.display_name as name,
               (select g.phone_e164 from guardians g where g.household_id = h.id
                order by g.is_billing_contact desc, g.created_at limit 1) as phone,
               case when exists (select 1 from standing_orders o where o.household_id = h.id and o.status = 'active')
                      then 'signed'
                    when exists (select 1 from checkouts c where c.household_id = h.id and c.purpose = 'mandate'
                                   and c.status = 'open' and c.expires_at > now())
                      then 'sent'
                    else 'none' end as state
        from households h
        where h.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)
        order by h.display_name`,
  );
}

/**
 * Sends every imported family that has not signed (and has no open link) a personal link to sign a standing order on
 * the business's processor, by WhatsApp. Needs a connected processor that offers standing orders.
 */
export async function requestMandates(
  tx: Tx,
  ctx: ServiceContext,
  input: { importId: string; publicUrl: string; description: string },
): Promise<number> {
  const list = await importMandates(tx, input.importId);
  let sent = 0;
  for (const m of list) {
    if (m.state !== 'none') continue;
    const c = await openCheckout(tx, ctx, {
      purpose: 'mandate',
      householdId: m.householdId,
      amountAgorot: 0,
      description: input.description,
      ref: { importId: input.importId },
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    });
    const url = `${input.publicUrl.replace(/\/$/, '')}/pay/${c.token}`;
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'billing.mandate_requested',
      payload: { householdId: m.householdId, url, checkoutId: c.id },
      idempotencyKey: `billing.mandate_requested:${c.id}`,
    });
    sent++;
  }
  return sent;
}
