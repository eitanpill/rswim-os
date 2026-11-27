/**
 * The GHL bridge's hook (docs/whatsapp/GHL-BRIDGE.md). A hook names its connection, not our tenant, so finding the
 * organization is a cross-tenant lookup: this file alone of the bridge may use the owner connection for it. Everything
 * after that runs inside the tenant.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { eq, schema, sql, type Db } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { emit } from '@rswim/domain-core';
import { GHL_BRIDGE_PULL_REQUESTED } from './ghl-bridge';

const { ghlConnections } = schema;

/** Where GHL's workflow puts the contact: its standard webhook (contact_id) or a custom body (contactId). */
const HookBody = z.looseObject({
  contact_id: z.string().optional(),
  contactId: z.string().optional(),
  contact: z.looseObject({ id: z.string().optional() }).optional(),
  customData: z
    .looseObject({ contact_id: z.string().optional(), contactId: z.string().optional() })
    .optional(),
});

/** The contact a hook names, or null. */
export function hookContactId(body: unknown): string | null {
  const p = HookBody.safeParse(body);
  if (!p.success) return null;
  const d = p.data;
  const id =
    d.contact_id ??
    d.contactId ??
    d.contact?.id ??
    d.customData?.contact_id ??
    d.customData?.contactId;
  return id && /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type GhlHookOutcome =
  'unknown_connection' | 'forbidden' | 'not_connected' | 'ignored' | 'queued';

/**
 * GHL's workflow says a contact wrote. The connection in the path names the business (looked up across tenants), the
 * token in the path must be its own, and the body only names the contact: the worker reads what was said from GHL.
 */
export async function ingestGhlBridgeHook(
  db: Db,
  connectionId: string,
  token: string,
  rawBody: string,
): Promise<GhlHookOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return 'unknown_connection';
  const [conn] = await asPlatform(db, (tx) =>
    tx
      .select({
        orgId: ghlConnections.organizationId,
        hookToken: ghlConnections.hookToken,
        status: ghlConnections.status,
        allowed: sql<boolean>`app.has_extra(${ghlConnections.organizationId}, 'ghl_bridge')`,
      })
      .from(ghlConnections)
      .where(eq(ghlConnections.id, connectionId)),
  );
  if (!conn) return 'unknown_connection';
  if (!sameToken(conn.hookToken, token)) return 'forbidden';
  if (conn.status !== 'connected' || !conn.allowed) return 'not_connected';
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return 'ignored';
  }
  const contactId = hookContactId(body);
  if (!contactId) return 'ignored';
  await withOrg(db, conn.orgId, (tx) =>
    emit(tx, {
      organizationId: conn.orgId,
      type: GHL_BRIDGE_PULL_REQUESTED,
      payload: { connectionId, contactId },
      idempotencyKey: `${GHL_BRIDGE_PULL_REQUESTED}:${connectionId}:${contactId}:${randomUUID()}`,
    }),
  );
  return 'queued';
}
