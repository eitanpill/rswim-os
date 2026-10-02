/**
 * GHL contact import and two-way sync. These run in the worker (withOrg), never in a web request: they call an
 * external API and must be retried safely.
 */
import { z } from 'zod';
import { eq, schema, type Tx } from '@rswim/db';
import { emit, type ServiceContext } from '@rswim/domain-core';
import { allContacts, type GhlClient, type GhlContact } from '@rswim/integrations';
import {
  inboundUpdate,
  planContactImport,
  shouldPush,
  syncHash,
  type ImportAction,
  type ImportPlan,
  type TagMap,
} from './policies';

const { guardians, households, importRuns, orgSettings } = schema;

/** `org_settings.integrations.ghl`: which GHL location this org is, and how its tags map to fields. */
export const GhlSettings = z.object({
  locationId: z.string().min(1),
  tagMap: z.record(z.string(), z.unknown()).default({}),
});

export async function ghlSettings(
  tx: Tx,
  orgId: string,
): Promise<{ locationId: string; tagMap: TagMap } | null> {
  const [row] = await tx
    .select({ integrations: orgSettings.integrations })
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, orgId));
  const parsed = GhlSettings.safeParse((row?.integrations as { ghl?: unknown } | undefined)?.ghl);
  return parsed.success
    ? { locationId: parsed.data.locationId, tagMap: parsed.data.tagMap as TagMap }
    : null;
}

/** Asks the worker to run an import; the web request returns at once. */
export async function requestContactImport(tx: Tx, ctx: ServiceContext): Promise<string> {
  const [run] = await tx
    .insert(importRuns)
    .values({ organizationId: ctx.orgId, provider: 'ghl', kind: 'contacts', createdBy: ctx.userId })
    .returning({ id: importRuns.id });
  const runId = (run as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'crm.import_requested',
    payload: { importRunId: runId },
    idempotencyKey: `crm.import_requested:${runId}`,
  });
  return runId;
}

/**
 * Reads all contacts, plans the import against current guardians, and applies it in the caller's transaction:
 * links by phone/email, creates a household + guardian for new people, and records a report line per contact.
 * Safe to run again: a second run only finds already-linked contacts.
 */
export async function runContactImport(
  tx: Tx,
  ctx: ServiceContext,
  client: GhlClient,
  tagMap: TagMap,
  importRunId?: string,
): Promise<{ runId: string; plan: ImportPlan }> {
  const contacts: GhlContact[] = [];
  for await (const c of allContacts(client, { organizationId: ctx.orgId, idempotencyKey: 'read' }))
    contacts.push(c);

  const existing = await tx
    .select({
      id: guardians.id,
      householdId: guardians.householdId,
      phoneE164: guardians.phoneE164,
      email: guardians.email,
      ghlContactId: guardians.ghlContactId,
    })
    .from(guardians);
  const plan = planContactImport(contacts, existing, tagMap);

  for (const a of plan.actions) await apply(tx, ctx, a);

  const report = plan.actions.map(reportLine);
  let runId = importRunId;
  if (runId) {
    await tx
      .update(importRuns)
      .set({ status: 'succeeded', stats: plan.stats, report, finishedAt: new Date() })
      .where(eq(importRuns.id, runId));
  } else {
    const [row] = await tx
      .insert(importRuns)
      .values({
        organizationId: ctx.orgId,
        provider: 'ghl',
        kind: 'contacts',
        status: 'succeeded',
        stats: plan.stats,
        report,
        createdBy: ctx.userId,
        finishedAt: new Date(),
      })
      .returning({ id: importRuns.id });
    runId = (row as { id: string }).id;
  }
  return { runId, plan };
}

async function apply(tx: Tx, ctx: ServiceContext, a: ImportAction) {
  if (a.action === 'link') {
    const [g] = await tx.select().from(guardians).where(eq(guardians.id, a.guardianId));
    if (!g) return;
    await tx
      .update(guardians)
      .set({
        ghlContactId: a.ghlId,
        crmProfile: a.profile,
        // The guardian's own data wins on link; the hash makes the next push send it to GHL once.
        ghlSyncedHash: null,
        ghlSyncedAt: new Date(),
      })
      .where(eq(guardians.id, a.guardianId));
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'people.guardian_upserted',
      payload: { guardianId: a.guardianId, source: 'import' },
      idempotencyKey: `people.guardian_upserted:${a.guardianId}:linked:${a.ghlId}`,
    });
  } else if (a.action === 'create') {
    const c = a.contact;
    const [h] = await tx
      .insert(households)
      .values({
        organizationId: ctx.orgId,
        displayName: `משפחת ${c.lastName || c.firstName}`,
        notes: 'יובא מ-GHL',
      })
      .returning({ id: households.id });
    const fields = {
      firstName: c.firstName || c.lastName,
      lastName: c.lastName || '-',
      phoneE164: c.phoneE164,
      email: c.email,
    };
    await tx.insert(guardians).values({
      organizationId: ctx.orgId,
      householdId: (h as { id: string }).id,
      ...fields,
      isBillingContact: true,
      ghlContactId: c.ghlId,
      crmProfile: a.profile,
      // Came from GHL as-is: nothing to push back.
      ghlSyncedHash: syncHash(fields),
      ghlSyncedAt: new Date(),
    });
  }
}

function reportLine(a: ImportAction): Record<string, unknown> {
  switch (a.action) {
    case 'link':
      return { ghlId: a.ghlId, action: a.action, guardianId: a.guardianId, matchedBy: a.matchedBy };
    case 'create':
      return {
        ghlId: a.ghlId,
        action: a.action,
        name: `${a.contact.firstName} ${a.contact.lastName}`.trim(),
      };
    default:
      return { ...a };
  }
}

/**
 * OS → GHL for one guardian. Skips when nothing changed since the last exchange (including the echo of a GHL
 * webhook we just applied). The idempotency key is the outbox event id, so a retried event upserts once.
 */
export async function pushGuardian(
  tx: Tx,
  ctx: ServiceContext,
  client: GhlClient,
  guardianId: string,
  idempotencyKey: string,
): Promise<'pushed' | 'unchanged' | 'missing'> {
  const [g] = await tx.select().from(guardians).where(eq(guardians.id, guardianId));
  if (!g) return 'missing';
  if (!shouldPush(g)) return 'unchanged';
  const { externalId } = await client.upsertContact(
    { organizationId: ctx.orgId, idempotencyKey },
    {
      externalId: g.ghlContactId ?? undefined,
      firstName: g.firstName,
      lastName: g.lastName,
      phoneE164: g.phoneE164 ?? undefined,
      email: g.email ?? undefined,
      tags: [],
      customFields: {},
    },
  );
  await tx
    .update(guardians)
    .set({ ghlContactId: externalId, ghlSyncedHash: syncHash(g), ghlSyncedAt: new Date() })
    .where(eq(guardians.id, guardianId));
  return 'pushed';
}

/** GHL → OS: a ContactCreate/ContactUpdate webhook for a linked guardian. Unknown contacts wait for an import. */
export async function applyContactWebhook(
  tx: Tx,
  contact: GhlContact,
): Promise<'updated' | 'echo' | 'unknown_contact'> {
  const [g] = await tx.select().from(guardians).where(eq(guardians.ghlContactId, contact.id));
  if (!g) return 'unknown_contact';
  const update = inboundUpdate(g, contact);
  if (!update) return 'echo';
  // No outbox event: the change came from GHL, and the matching hash stops it from being pushed back.
  await tx
    .update(guardians)
    .set({ ...update, ghlSyncedAt: new Date() })
    .where(eq(guardians.id, g.id));
  return 'updated';
}
