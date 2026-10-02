/**
 * GHL webhook intake (ContactCreate / ContactUpdate). A webhook names its GHL location, not our tenant, so finding
 * the organization is a cross-tenant lookup: this is one of the few places allowed to use the owner connection
 * (ADR-0005). It only stores the raw event and queues it; the worker applies it inside the org's RLS scope.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, schema, sql, type Db } from '@rswim/db';
import { asPlatform } from '@rswim/db/service';
import { emit } from '@rswim/domain-core';
import type { GhlContact } from '@rswim/integrations';

const { orgSettings, webhookEvents } = schema;

export const GhlContactWebhook = z.looseObject({
  type: z.string(),
  locationId: z.string().min(1),
  id: z.string().min(1),
  webhookId: z.string().optional(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  dateUpdated: z.string().optional(),
});

const CONTACT_EVENTS = new Set(['ContactCreate', 'ContactUpdate']);

export type WebhookIntake = 'queued' | 'duplicate' | 'ignored' | 'unknown_location';

/** Stores a verified webhook once (by its webhook id, else a hash of the body) and queues it for the worker. */
export async function ingestGhlWebhook(db: Db, rawBody: string): Promise<WebhookIntake> {
  const parsed = GhlContactWebhook.safeParse(JSON.parse(rawBody));
  if (!parsed.success || !CONTACT_EVENTS.has(parsed.data.type)) return 'ignored';
  const body = parsed.data;
  const externalId = body.webhookId ?? createHash('sha256').update(rawBody).digest('hex');
  return asPlatform(db, async (tx) => {
    const [org] = await tx
      .select({ id: orgSettings.organizationId })
      .from(orgSettings)
      .where(sql`${orgSettings.integrations} -> 'ghl' ->> 'locationId' = ${body.locationId}`);
    if (!org) return 'unknown_location';
    const [row] = await tx
      .insert(webhookEvents)
      .values({ organizationId: org.id, provider: 'ghl', externalId, raw: body })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!row) return 'duplicate';
    await emit(tx, {
      organizationId: org.id,
      type: 'crm.contact_webhook_received',
      payload: { webhookEventId: row.id },
      idempotencyKey: `crm.contact_webhook_received:${row.id}`,
    });
    return 'queued';
  });
}

/** The contact carried by a stored webhook, for the worker. Scoped to the event's organization. */
export async function webhookContact(
  db: Db,
  orgId: string,
  webhookEventId: string,
): Promise<GhlContact | null> {
  const [row] = await asPlatform(db, (tx) =>
    tx
      .select({ raw: webhookEvents.raw })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.id, webhookEventId), eq(webhookEvents.organizationId, orgId))),
  );
  if (!row) return null;
  const c = GhlContactWebhook.parse(row.raw);
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    tags: c.tags,
  };
}

export async function markWebhookProcessed(db: Db, webhookEventId: string, status: string) {
  await asPlatform(db, (tx) =>
    tx
      .update(webhookEvents)
      .set({ status, processedAt: new Date() })
      .where(eq(webhookEvents.id, webhookEventId)),
  );
}
