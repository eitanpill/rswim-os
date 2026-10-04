/**
 * GHL InboundMessage intake. A webhook names its GHL location, not our tenant, so finding the organization is a
 * cross-tenant lookup (ADR-0005): this file alone may use the owner connection for it. Everything after that runs
 * inside the tenant as its worker (RLS applies), and in the same request, so the draft action exists by the time GHL
 * gets its answer.
 */
import { z } from 'zod';
import { toE164IL } from '@rswim/contracts';
import { schema, sql, type Db } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { intakeInbound, type IntakeResult } from './inbox';

const { orgSettings, webhookEvents } = schema;

export const GhlInboundWebhook = z.looseObject({
  type: z.literal('InboundMessage'),
  locationId: z.string().min(1),
  messageId: z.string().min(1),
  contactId: z.string().nullish(),
  phone: z.string().nullish(),
  body: z.string().default(''),
  messageType: z.string().optional(),
  direction: z.string().optional(),
  dateAdded: z.string().optional(),
});

export type InboundWebhookResult =
  'ignored' | 'unknown_location' | 'duplicate' | Extract<IntakeResult, { outcome: 'stored' }>;

/** True for a GHL webhook this module handles (the CRM handles contact events). */
export function isInboundMessage(body: unknown): boolean {
  return (body as { type?: unknown } | null)?.type === 'InboundMessage';
}

export async function ingestInboundMessage(
  db: Db,
  rawBody: string,
  now: Date = new Date(),
): Promise<InboundWebhookResult> {
  const parsed = GhlInboundWebhook.safeParse(JSON.parse(rawBody));
  if (!parsed.success || (parsed.data.direction && parsed.data.direction !== 'inbound'))
    return 'ignored';
  const m = parsed.data;
  const orgId = await asPlatform(db, async (tx) => {
    const [org] = await tx
      .select({ id: orgSettings.organizationId })
      .from(orgSettings)
      .where(sql`${orgSettings.integrations} -> 'ghl' ->> 'locationId' = ${m.locationId}`);
    if (!org) return null;
    const [row] = await tx
      .insert(webhookEvents)
      .values({ organizationId: org.id, provider: 'ghl', externalId: `msg:${m.messageId}`, raw: m })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    return row ? org.id : 'duplicate';
  });
  if (orgId === null) return 'unknown_location';
  if (orgId === 'duplicate') return 'duplicate';
  const receivedAt =
    m.dateAdded && !Number.isNaN(Date.parse(m.dateAdded)) ? new Date(m.dateAdded) : now;
  const result = await withOrg(db, orgId, (tx) =>
    intakeInbound(
      tx,
      { orgId, userId: null },
      {
        provider: 'ghl',
        externalId: m.messageId,
        phoneE164: m.phone ? toE164IL(m.phone) : null,
        ghlContactId: m.contactId ?? null,
        body: m.body,
        receivedAt,
      },
    ),
  );
  return result.outcome === 'duplicate' ? 'duplicate' : result;
}
