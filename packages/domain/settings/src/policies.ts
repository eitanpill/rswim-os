/**
 * Pure resolution of versioned settings (ADR-0004): which policy rules and which price apply to a given
 * venue / program / class template on a given date, and why.
 */
import type { PolicyRules, PriceItemKind, ScopeType } from '@rswim/contracts';
import { agorot, type Agorot } from '@rswim/money';

// ─── Policy sets ────────────────────────────────────────────────────────────

export interface PolicySetVersion {
  id: string;
  scopeType: ScopeType;
  venueId: string | null;
  programId: string | null;
  classTemplateId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // exclusive
  rules: PolicyRules;
}

export interface PolicyContext {
  date: string;
  venueId?: string | null;
  programId?: string | null;
  classTemplateId?: string | null;
}

export interface ResolvedPolicy {
  rules: PolicyRules;
  /** Contributing versions, least specific first. */
  sources: { id: string; scopeType: ScopeType; effectiveFrom: string }[];
  /** Which version set each leaf, e.g. { 'absence.notice_min_hours': '<policy set id>' }. */
  origin: Record<string, string>;
  /** Stable identifier of the combination, stored with every decision for explainability. */
  versionKey: string;
}

/** Least specific first: later scopes override earlier ones. */
const MERGE_ORDER: ScopeType[] = ['org', 'venue', 'program', 'venue_program', 'class_template'];

export const isActiveOn = (
  v: { effectiveFrom: string; effectiveTo: string | null },
  date: string,
) => v.effectiveFrom <= date && (v.effectiveTo === null || date < v.effectiveTo);

function matchesScope(v: PolicySetVersion, ctx: PolicyContext): boolean {
  switch (v.scopeType) {
    case 'org':
      return true;
    case 'venue':
      return v.venueId === ctx.venueId;
    case 'program':
      return v.programId === ctx.programId;
    case 'venue_program':
      return v.venueId === ctx.venueId && v.programId === ctx.programId;
    case 'class_template':
      return v.classTemplateId === ctx.classTemplateId;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge where `over` wins; arrays and scalars are replaced, objects merged. Records each leaf's origin. */
function mergeInto(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
  sourceId: string,
  origin: Record<string, string>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const prev = out[k];
    if (isPlainObject(v)) {
      out[k] = mergeInto(isPlainObject(prev) ? prev : {}, v, sourceId, origin, path);
    } else {
      out[k] = v;
      origin[path] = sourceId;
    }
  }
  return out;
}

/**
 * For each scope that matches the context, takes the version active on the date (the latest `effectiveFrom`
 * wins), then merges them from org down to class template.
 */
export function resolvePolicy(
  versions: readonly PolicySetVersion[],
  ctx: PolicyContext,
): ResolvedPolicy {
  const picked: PolicySetVersion[] = [];
  for (const scope of MERGE_ORDER) {
    const candidates = versions
      .filter((v) => v.scopeType === scope && matchesScope(v, ctx) && isActiveOn(v, ctx.date))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    if (candidates[0]) picked.push(candidates[0]);
  }
  const origin: Record<string, string> = {};
  let rules: Record<string, unknown> = {};
  for (const v of picked)
    rules = mergeInto(rules, v.rules as Record<string, unknown>, v.id, origin, '');
  return {
    rules: rules as PolicyRules,
    sources: picked.map((v) => ({
      id: v.id,
      scopeType: v.scopeType,
      effectiveFrom: v.effectiveFrom,
    })),
    origin,
    versionKey: picked.map((v) => v.id).join('+'),
  };
}

// ─── Price lists ────────────────────────────────────────────────────────────

export interface PriceItemRow {
  id: string;
  programId: string;
  kind: PriceItemKind;
  durationMin: number | null;
  sessionsCount: number | null;
  amountAgorot: number;
}

export interface PriceListVersion {
  id: string;
  name: string;
  venueId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'draft' | 'published' | 'archived';
  items: readonly PriceItemRow[];
}

export interface PriceQuery {
  date: string;
  venueId: string | null;
  programId: string;
  kind: PriceItemKind;
  durationMin?: number | null;
  sessionsCount?: number | null;
}

export interface ResolvedPrice {
  amount: Agorot;
  priceListId: string;
  priceListName: string;
  itemId: string;
  scope: 'venue' | 'org';
  effectiveFrom: string;
}

/**
 * The price on a date: venue lists before org lists, newest active version first, and inside a list an item for
 * the exact duration before an any-duration item. Drafts never apply; an archived list still answers for the dates
 * it was in effect (history).
 */
export function resolvePrice(
  lists: readonly PriceListVersion[],
  q: PriceQuery,
): ResolvedPrice | null {
  const active = lists
    .filter((l) => l.status !== 'draft' && isActiveOn(l, q.date))
    .filter((l) => l.venueId === null || l.venueId === q.venueId)
    .sort(
      (a, b) =>
        Number(b.venueId !== null) - Number(a.venueId !== null) ||
        b.effectiveFrom.localeCompare(a.effectiveFrom),
    );
  for (const list of active) {
    const matching = list.items.filter(
      (i) =>
        i.programId === q.programId &&
        i.kind === q.kind &&
        i.sessionsCount === (q.sessionsCount ?? null) &&
        (i.durationMin === null || i.durationMin === (q.durationMin ?? null)),
    );
    const item = matching.find((i) => i.durationMin !== null) ?? matching[0];
    if (item) {
      return {
        amount: agorot(item.amountAgorot),
        priceListId: list.id,
        priceListName: list.name,
        itemId: item.id,
        scope: list.venueId === null ? 'org' : 'venue',
        effectiveFrom: list.effectiveFrom,
      };
    }
  }
  return null;
}
