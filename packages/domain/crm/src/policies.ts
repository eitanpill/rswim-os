/**
 * Pure rules for linking GoHighLevel contacts to guardians (brief §8.1: import GHL contacts, tags → structured
 * fields, dedupe by phone) and for two-way sync without echo loops.
 */
import { createHash } from 'node:crypto';
import { toE164IL, type ProgramKind } from '@rswim/contracts';
import type { GhlContact } from '@rswim/integrations';

// ─── Tag mapping (per tenant configuration) ─────────────────────────────────

/** What one GHL tag means. Tag vocabularies differ per tenant, so the map lives in org settings. */
export type TagMeaning =
  | { field: 'program_interest'; value: ProgramKind }
  | { field: 'age_band'; value: string }
  | { field: 'water_fear'; value: boolean }
  | { field: 'branch'; value: string }
  | { field: 'flag'; value: string };

export type TagMap = Record<string, TagMeaning>;

/** R-SWIM's existing GHL tag taxonomy (brief §1.6). New tenants start from an empty map. */
export const RSWIM_TAG_MAP: TagMap = {
  'שחיית תינוקות': { field: 'program_interest', value: 'baby' },
  'ילדים ונוער': { field: 'program_interest', value: 'group_kids' },
  'שחיית מבוגרים': { field: 'program_interest', value: 'adult_beginner' },
  'לימוד-שיפור סגנון': { field: 'program_interest', value: 'adult_style' },
  'יש פחד מים': { field: 'water_fear', value: true },
  'אין פחד ממים': { field: 'water_fear', value: false },
  '3-9 חודשים': { field: 'age_band', value: '3-9m' },
  '1-3 שנים': { field: 'age_band', value: '1-3y' },
  '3-4': { field: 'age_band', value: '3-4y' },
  '5-7': { field: 'age_band', value: '5-7y' },
  '8+': { field: 'age_band', value: '8y+' },
  'שיעורי שחייה הר חומה': { field: 'branch', value: 'הר חומה' },
  'ליד חם': { field: 'flag', value: 'warm_lead' },
  פולואפ: { field: 'flag', value: 'follow_up' },
  'עדיפות גבוהה': { field: 'flag', value: 'high_priority' },
};

export interface CrmProfile {
  programInterest: ProgramKind[];
  ageBands: string[];
  waterFear: boolean | null;
  branches: string[];
  flags: string[];
  /** Tags with no meaning in the map, kept so nothing is lost. */
  unmappedTags: string[];
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Turns tags into structured fields. Tag matching ignores case and surrounding spaces. */
export function profileFromTags(tags: readonly string[], map: TagMap): CrmProfile {
  const index = new Map(Object.entries(map).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const p: CrmProfile = {
    programInterest: [],
    ageBands: [],
    waterFear: null,
    branches: [],
    flags: [],
    unmappedTags: [],
  };
  for (const tag of tags) {
    const m = index.get(tag.trim().toLowerCase());
    if (!m) p.unmappedTags.push(tag);
    else if (m.field === 'program_interest') p.programInterest.push(m.value);
    else if (m.field === 'age_band') p.ageBands.push(m.value);
    // "has fear" wins over "no fear" if a contact carries both.
    else if (m.field === 'water_fear') p.waterFear = p.waterFear === true || m.value;
    else if (m.field === 'branch') p.branches.push(m.value);
    else p.flags.push(m.value);
  }
  return {
    ...p,
    programInterest: uniq(p.programInterest),
    ageBands: uniq(p.ageBands),
    branches: uniq(p.branches),
    flags: uniq(p.flags),
    unmappedTags: uniq(p.unmappedTags),
  };
}

// ─── Normalisation ──────────────────────────────────────────────────────────

export interface NormalisedContact {
  ghlId: string;
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  tags: string[];
  dateAdded: string;
}

/** Hebrew contacts often carry the whole name in one field; split "first last…" when only one part is present. */
export function normaliseContact(c: GhlContact): NormalisedContact {
  let first = (c.firstName ?? '').trim();
  let last = (c.lastName ?? '').trim();
  if (!first && !last) first = (c.contactName ?? '').trim();
  if (first && !last) [first, last] = splitName(first);
  const email = c.email?.trim().toLowerCase() || null;
  return {
    ghlId: c.id,
    firstName: first,
    lastName: last,
    phoneE164: c.phone ? toE164IL(c.phone) : null,
    email,
    tags: c.tags ?? [],
    dateAdded: c.dateAdded ?? '',
  };
}

function splitName(full: string): [string, string] {
  const parts = full.split(/\s+/);
  return [parts[0] as string, parts.slice(1).join(' ')];
}

// ─── Import planning ────────────────────────────────────────────────────────

export interface ExistingGuardian {
  id: string;
  householdId: string;
  phoneE164: string | null;
  email: string | null;
  ghlContactId: string | null;
}

export type ImportAction =
  | { action: 'already_linked'; ghlId: string; guardianId: string }
  | {
      action: 'link';
      ghlId: string;
      guardianId: string;
      matchedBy: 'phone' | 'email';
      profile: CrmProfile;
    }
  | { action: 'create'; ghlId: string; contact: NormalisedContact; profile: CrmProfile }
  | { action: 'duplicate_in_ghl'; ghlId: string; primaryGhlId: string }
  | { action: 'conflict'; ghlId: string; guardianId: string; linkedGhlId: string }
  | { action: 'skipped'; ghlId: string; reason: 'no_phone_or_email' | 'no_name' };

export interface ImportPlan {
  actions: ImportAction[];
  stats: Record<ImportAction['action'], number>;
}

/**
 * Decides, for every GHL contact, whether it is already linked, should link to an existing guardian (same phone,
 * else same email), should create a new household + guardian, or is a duplicate of another GHL contact with the
 * same phone or email. Running the plan twice yields only `already_linked` and `duplicate_in_ghl` the second time.
 */
export function planContactImport(
  contacts: readonly GhlContact[],
  guardians: readonly ExistingGuardian[],
  tagMap: TagMap,
): ImportPlan {
  const byGhl = new Map(
    guardians.filter((g) => g.ghlContactId).map((g) => [g.ghlContactId as string, g]),
  );
  const byPhone = groupBy(guardians, (g) => g.phoneE164);
  const byEmail = groupBy(guardians, (g) => g.email?.toLowerCase() ?? null);
  const claimed = new Set<string>(); // guardians linked during this run

  // Contacts already linked go first, so they stay primary when GHL has duplicates; then oldest first.
  const normalised = contacts
    .map(normaliseContact)
    .sort(
      (a, b) =>
        Number(byGhl.has(b.ghlId)) - Number(byGhl.has(a.ghlId)) ||
        a.dateAdded.localeCompare(b.dateAdded) ||
        a.ghlId.localeCompare(b.ghlId),
    );
  const seenIdentity = new Map<string, string>(); // phone/email → primary GHL id
  const actions: ImportAction[] = [];

  for (const c of normalised) {
    const keys = [c.phoneE164 && `p:${c.phoneE164}`, c.email && `e:${c.email}`].filter(
      Boolean,
    ) as string[];
    const linked = byGhl.get(c.ghlId);
    if (linked) {
      actions.push({ action: 'already_linked', ghlId: c.ghlId, guardianId: linked.id });
      for (const k of keys) if (!seenIdentity.has(k)) seenIdentity.set(k, c.ghlId);
      claimed.add(linked.id);
      continue;
    }
    if (keys.length === 0) {
      actions.push({ action: 'skipped', ghlId: c.ghlId, reason: 'no_phone_or_email' });
      continue;
    }
    const primary = keys.map((k) => seenIdentity.get(k)).find(Boolean);
    if (primary) {
      actions.push({ action: 'duplicate_in_ghl', ghlId: c.ghlId, primaryGhlId: primary });
      continue;
    }
    for (const k of keys) seenIdentity.set(k, c.ghlId);

    const profile = profileFromTags(c.tags, tagMap);
    const match =
      pick(c.phoneE164 ? byPhone.get(c.phoneE164) : undefined, claimed, 'phone') ??
      pick(c.email ? byEmail.get(c.email) : undefined, claimed, 'email');
    if (match?.guardian.ghlContactId) {
      actions.push({
        action: 'conflict',
        ghlId: c.ghlId,
        guardianId: match.guardian.id,
        linkedGhlId: match.guardian.ghlContactId,
      });
    } else if (match) {
      claimed.add(match.guardian.id);
      actions.push({
        action: 'link',
        ghlId: c.ghlId,
        guardianId: match.guardian.id,
        matchedBy: match.by,
        profile,
      });
    } else if (!c.firstName && !c.lastName) {
      actions.push({ action: 'skipped', ghlId: c.ghlId, reason: 'no_name' });
    } else {
      actions.push({ action: 'create', ghlId: c.ghlId, contact: c, profile });
    }
  }

  const stats = {
    already_linked: 0,
    link: 0,
    create: 0,
    duplicate_in_ghl: 0,
    conflict: 0,
    skipped: 0,
  } satisfies ImportPlan['stats'];
  for (const a of actions) stats[a.action]++;
  return { actions, stats };
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (k) m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

/** First guardian with this identity not already linked in this run: unlinked guardians before linked ones. */
function pick(
  candidates: ExistingGuardian[] | undefined,
  claimed: Set<string>,
  by: 'phone' | 'email',
): { guardian: ExistingGuardian; by: 'phone' | 'email' } | null {
  const free = (candidates ?? []).filter((g) => !claimed.has(g.id));
  const guardian = free.find((g) => !g.ghlContactId) ?? free[0];
  return guardian ? { guardian, by } : null;
}

// ─── Two-way sync ───────────────────────────────────────────────────────────

export interface SyncedFields {
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
}

/** Fingerprint of the fields both systems share. Equal fingerprints mean there is nothing to send. */
export function syncHash(f: SyncedFields): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        f.firstName.trim(),
        f.lastName.trim(),
        f.phoneE164,
        f.email?.toLowerCase() ?? null,
      ]),
    )
    .digest('hex')
    .slice(0, 32);
}

/** OS → GHL: push only when the guardian changed since the last exchange (so an inbound update is not echoed). */
export function shouldPush(guardian: SyncedFields & { ghlSyncedHash: string | null }): boolean {
  return syncHash(guardian) !== guardian.ghlSyncedHash;
}

/**
 * GHL → OS: the update to apply to a linked guardian, or null when the webhook only echoes what we sent.
 * Empty values from GHL never erase data in R-SWIM OS.
 */
export function inboundUpdate(
  guardian: SyncedFields & { ghlSyncedHash: string | null },
  contact: GhlContact,
): (SyncedFields & { ghlSyncedHash: string }) | null {
  const c = normaliseContact(contact);
  const next: SyncedFields = {
    firstName: c.firstName || guardian.firstName,
    lastName: c.lastName || guardian.lastName,
    phoneE164: c.phoneE164 ?? guardian.phoneE164,
    email: c.email ?? guardian.email,
  };
  const hash = syncHash(next);
  if (hash === guardian.ghlSyncedHash || hash === syncHash(guardian)) return null;
  return { ...next, ghlSyncedHash: hash };
}
