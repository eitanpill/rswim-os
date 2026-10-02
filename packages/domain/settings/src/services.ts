/**
 * Programs, levels, policy versions and price lists (ADR-0004). Versions in effect are immutable (enforced by
 * triggers in 0003); a change is a new version from a date.
 */
import { z } from 'zod';
import {
  optionalInt,
  optionalText,
  PolicyRules,
  PRICE_ITEM_KINDS,
  PROGRAM_KINDS,
  requiredDate,
  requiredInt,
  requiredText,
  type PriceItemKind,
  type ScopeType,
} from '@rswim/contracts';
import { and, asc, desc, eq, inArray, isNull, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import {
  resolvePolicy,
  resolvePrice,
  type PolicyContext,
  type PriceListVersion,
  type PriceQuery,
} from './policies';

const { programs, levels, policySets, priceLists, priceItems } = schema;

// ─── Programs & levels ──────────────────────────────────────────────────────

export const ProgramInput = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{2,40}$/, 'settings.errors.code'),
    kind: z.enum(PROGRAM_KINDS),
    nameHe: requiredText(80),
    nameEn: optionalText(80),
    defaultDurationMin: requiredInt(5, 240),
    defaultCapacity: requiredInt(1, 100),
    minAgeMonths: optionalInt(0, 1200),
    maxAgeMonths: optionalInt(0, 1200),
    parentInWater: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
    active: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  })
  .refine(
    (p) => p.minAgeMonths === null || p.maxAgeMonths === null || p.maxAgeMonths >= p.minAgeMonths,
    {
      message: 'settings.errors.ageRange',
      path: ['maxAgeMonths'],
    },
  );
export type ProgramInput = z.infer<typeof ProgramInput>;

export const LevelInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{2,40}$/, 'settings.errors.code'),
  nameHe: requiredText(80),
  nameEn: optionalText(80),
  /** One skill per line in the form. */
  skills: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((he, i) => ({ code: `s${i + 1}`, he })),
    ),
});
export type LevelInput = z.infer<typeof LevelInput>;

export async function listPrograms(tx: Tx) {
  const rows = await tx
    .select()
    .from(programs)
    .orderBy(asc(programs.sortOrder), asc(programs.nameHe));
  const levelRows = await tx.select().from(levels).orderBy(asc(levels.ordinal));
  return rows.map((p) => ({ ...p, levels: levelRows.filter((l) => l.programId === p.id) }));
}

export async function createProgram(tx: Tx, ctx: ServiceContext, input: ProgramInput) {
  const [row] = await tx
    .insert(programs)
    .values({ ...input, organizationId: ctx.orgId })
    .returning({ id: programs.id });
  return (row as { id: string }).id;
}

export async function updateProgram(tx: Tx, programId: string, input: ProgramInput) {
  await tx.update(programs).set(input).where(eq(programs.id, programId));
}

export async function addLevel(tx: Tx, ctx: ServiceContext, programId: string, input: LevelInput) {
  const existing = await tx
    .select({ ordinal: levels.ordinal })
    .from(levels)
    .where(eq(levels.programId, programId));
  const ordinal = Math.max(0, ...existing.map((l) => l.ordinal)) + 1;
  await tx.insert(levels).values({ ...input, programId, ordinal, organizationId: ctx.orgId });
}

export async function deleteLevel(tx: Tx, levelId: string) {
  await tx.delete(levels).where(eq(levels.id, levelId));
}

/** Swaps a level with its neighbour on the ladder. */
export async function moveLevel(tx: Tx, levelId: string, direction: 'up' | 'down') {
  const [level] = await tx.select().from(levels).where(eq(levels.id, levelId));
  if (!level) return;
  const ladder = await tx
    .select()
    .from(levels)
    .where(eq(levels.programId, level.programId))
    .orderBy(asc(levels.ordinal));
  const i = ladder.findIndex((l) => l.id === levelId);
  const other = ladder[direction === 'up' ? i - 1 : i + 1];
  if (!other) return;
  await tx.update(levels).set({ ordinal: other.ordinal }).where(eq(levels.id, level.id));
  await tx.update(levels).set({ ordinal: level.ordinal }).where(eq(levels.id, other.id));
}

// ─── Policy versions ────────────────────────────────────────────────────────

export interface PolicyScope {
  scopeType: ScopeType;
  venueId?: string | null;
  programId?: string | null;
  classTemplateId?: string | null;
}

const scopeWhere = (s: PolicyScope) =>
  and(
    eq(policySets.scopeType, s.scopeType),
    s.venueId ? eq(policySets.venueId, s.venueId) : isNull(policySets.venueId),
    s.programId ? eq(policySets.programId, s.programId) : isNull(policySets.programId),
    s.classTemplateId
      ? eq(policySets.classTemplateId, s.classTemplateId)
      : isNull(policySets.classTemplateId),
  );

/** Versions of one scope, newest first. */
export async function listPolicyVersions(tx: Tx, scope: PolicyScope) {
  return tx
    .select()
    .from(policySets)
    .where(scopeWhere(scope))
    .orderBy(desc(policySets.effectiveFrom));
}

export const PolicyVersionInput = z.object({
  effectiveFrom: requiredDate(),
  rules: PolicyRules,
  notes: optionalText(500),
});

/**
 * Adds a version from a date. The previous open-ended version of the same scope keeps running until then (the
 * resolver picks the latest version in effect), so no row in effect is touched.
 */
export async function createPolicyVersion(
  tx: Tx,
  ctx: ServiceContext,
  scope: PolicyScope,
  input: z.infer<typeof PolicyVersionInput>,
): Promise<string> {
  const existing = await listPolicyVersions(tx, scope);
  if (existing.some((v) => v.effectiveFrom === input.effectiveFrom)) {
    throw new DomainError('settings.errors.duplicateStart');
  }
  const [row] = await tx
    .insert(policySets)
    .values({
      organizationId: ctx.orgId,
      scopeType: scope.scopeType,
      venueId: scope.venueId ?? null,
      programId: scope.programId ?? null,
      classTemplateId: scope.classTemplateId ?? null,
      effectiveFrom: input.effectiveFrom,
      rules: input.rules,
      notes: input.notes,
      createdBy: ctx.userId,
    })
    .returning({ id: policySets.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'settings.policy_version_created',
    payload: { policySetId: id, scopeType: scope.scopeType, effectiveFrom: input.effectiveFrom },
    idempotencyKey: `settings.policy_version_created:${id}`,
  });
  return id;
}

/**
 * The rules that apply in a context on a date, with the versions they came from. `exclude` leaves one scope's own
 * versions out, which answers "what would this scope inherit if it set nothing?" for the editor.
 */
export async function resolvePolicyFor(tx: Tx, ctx: PolicyContext, exclude?: PolicyScope) {
  const rows = await tx.select().from(policySets);
  const isExcluded = (r: (typeof rows)[number]) =>
    exclude !== undefined &&
    r.scopeType === exclude.scopeType &&
    r.venueId === (exclude.venueId ?? null) &&
    r.programId === (exclude.programId ?? null) &&
    r.classTemplateId === (exclude.classTemplateId ?? null);
  return resolvePolicy(
    rows
      .filter((r) => !isExcluded(r))
      .map((r) => ({ ...r, scopeType: r.scopeType as ScopeType, rules: r.rules as PolicyRules })),
    ctx,
  );
}

// ─── Price lists ────────────────────────────────────────────────────────────

export const PriceListInput = z.object({
  name: requiredText(120),
  venueId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  effectiveFrom: requiredDate(),
  notes: optionalText(500),
});
export type PriceListInput = z.infer<typeof PriceListInput>;

export const PriceItemInput = z.object({
  programId: z.uuid(),
  kind: z.enum(PRICE_ITEM_KINDS),
  durationMin: optionalInt(5, 240),
  sessionsCount: optionalInt(1, 200),
  amountAgorot: z.int().min(0),
  label: optionalText(120),
});
export type PriceItemInput = z.infer<typeof PriceItemInput>;

export async function listPriceLists(tx: Tx) {
  return tx.select().from(priceLists).orderBy(desc(priceLists.effectiveFrom), asc(priceLists.name));
}

export async function getPriceList(tx: Tx, id: string) {
  const [list] = await tx.select().from(priceLists).where(eq(priceLists.id, id));
  if (!list) return null;
  const items = await tx.select().from(priceItems).where(eq(priceItems.priceListId, id));
  return { ...list, items };
}

export async function createPriceList(
  tx: Tx,
  ctx: ServiceContext,
  input: PriceListInput,
): Promise<string> {
  const [row] = await tx
    .insert(priceLists)
    .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
    .returning({ id: priceLists.id });
  return (row as { id: string }).id;
}

/** Copies a list's items into a new draft starting on another date: the usual way to raise prices. */
export async function duplicatePriceList(
  tx: Tx,
  ctx: ServiceContext,
  sourceId: string,
  input: PriceListInput,
): Promise<string> {
  const source = await getPriceList(tx, sourceId);
  if (!source) throw new DomainError('common.errors.notFound');
  const id = await createPriceList(tx, ctx, input);
  if (source.items.length) {
    await tx.insert(priceItems).values(
      source.items.map(({ programId, kind, durationMin, sessionsCount, amountAgorot, label }) => ({
        organizationId: ctx.orgId,
        priceListId: id,
        programId,
        kind,
        durationMin,
        sessionsCount,
        amountAgorot,
        label,
      })),
    );
  }
  return id;
}

export async function savePriceItem(
  tx: Tx,
  ctx: ServiceContext,
  priceListId: string,
  input: PriceItemInput,
) {
  if (input.kind === 'package' && !input.sessionsCount)
    throw new DomainError('settings.errors.packageSessions');
  await tx
    .insert(priceItems)
    .values({ ...input, priceListId, organizationId: ctx.orgId })
    .onConflictDoUpdate({
      target: [
        priceItems.priceListId,
        priceItems.programId,
        priceItems.kind,
        priceItems.durationMin,
        priceItems.sessionsCount,
      ],
      set: { amountAgorot: input.amountAgorot, label: input.label },
    });
}

export async function deletePriceItem(tx: Tx, itemId: string) {
  await tx.delete(priceItems).where(eq(priceItems.id, itemId));
}

export async function publishPriceList(tx: Tx, ctx: ServiceContext, id: string) {
  const list = await getPriceList(tx, id);
  if (!list) throw new DomainError('common.errors.notFound');
  if (list.items.length === 0) throw new DomainError('settings.errors.emptyPriceList');
  await tx.update(priceLists).set({ status: 'published' }).where(eq(priceLists.id, id));
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'settings.price_list_published',
    payload: { priceListId: id, venueId: list.venueId, effectiveFrom: list.effectiveFrom },
    idempotencyKey: `settings.price_list_published:${id}`,
  });
}

export async function deletePriceList(tx: Tx, id: string) {
  await tx.delete(priceLists).where(eq(priceLists.id, id));
}

/** "What does X cost at venue Y on date Z?" — the same resolution billing will use. */
export async function priceFor(tx: Tx, q: PriceQuery) {
  const lists = await tx.select().from(priceLists);
  const items = lists.length
    ? await tx
        .select()
        .from(priceItems)
        .where(
          inArray(
            priceItems.priceListId,
            lists.map((l) => l.id),
          ),
        )
    : [];
  const versions: PriceListVersion[] = lists.map((l) => ({
    ...l,
    status: l.status as PriceListVersion['status'],
    items: items
      .filter((i) => i.priceListId === l.id)
      .map((i) => ({ ...i, kind: i.kind as PriceItemKind })),
  }));
  return resolvePrice(versions, q);
}
