/**
 * Meta's webhook for a business's own WhatsApp number (WhatsApp track W5). The connection in the URL names the
 * business, so it is looked up across tenants (the owner connection) before anything runs as that tenant.
 */
import { and, eq, schema, type Db } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import { verifyMetaSignature } from '@rswim/integrations';
import { parseMetaWebhook } from '../policies';
import { intakeInbound } from './inbox';
import { loadWhatsApp } from './whatsapp';

const { whatsappConnections, messages } = schema;

const orgOfConnection = async (db: Db, connectionId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const [row] = await asPlatform(db, (tx) =>
    tx
      .select({
        orgId: whatsappConnections.organizationId,
        verifyToken: whatsappConnections.verifyToken,
      })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.id, connectionId)),
  );
  return row ?? null;
};

/** Meta's subscription check (GET hub.mode=subscribe): the challenge back when the verify token is the connection's. */
export async function metaSubscriptionCheck(
  db: Db,
  connectionId: string,
  q: { mode: string | null; token: string | null; challenge: string | null },
): Promise<string | null> {
  if (q.mode !== 'subscribe' || !q.token || !q.challenge) return null;
  const conn = await orgOfConnection(db, connectionId);
  return conn && conn.verifyToken === q.token ? q.challenge : null;
}

export type MetaWebhookOutcome =
  | 'unknown_connection'
  | 'not_connected'
  | 'rejected'
  | { inbound: number; duplicates: number; receipts: number };

/**
 * Meta's webhook for one connection: checked against the business's app secret (a forged one is refused), then each
 * message goes into the inbox once (by Meta's id) and each receipt onto the message it is about.
 */
export async function ingestMetaWebhook(
  db: Db,
  connectionId: string,
  rawBody: string,
  signature: string | null,
): Promise<MetaWebhookOutcome> {
  const conn = await orgOfConnection(db, connectionId);
  if (!conn) return 'unknown_connection';
  const orgId = conn.orgId;
  const loaded = await withOrg(db, orgId, (tx) => loadWhatsApp(tx, orgId));
  if (!loaded || loaded.connectionId !== connectionId) return 'not_connected';
  if (!verifyMetaSignature(rawBody, signature, loaded.appSecret)) return 'rejected';
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return 'rejected';
  }
  const parsed = parseMetaWebhook(body);
  const ctx = { orgId, userId: null };
  const out = { inbound: 0, duplicates: 0, receipts: 0 };
  for (const m of parsed.inbound) {
    if (m.phoneNumberId && m.phoneNumberId !== loaded.phoneNumberId) continue;
    const r = await withOrg(db, orgId, async (tx) => {
      const stored = await intakeInbound(tx, ctx, {
        provider: 'meta',
        externalId: m.id,
        phoneE164: m.fromE164,
        ghlContactId: null,
        body: m.text,
        receivedAt: m.at,
      });
      await tx
        .update(whatsappConnections)
        .set({ lastInboundAt: m.at })
        .where(eq(whatsappConnections.id, connectionId));
      return stored;
    });
    if (r.outcome === 'duplicate') out.duplicates++;
    else out.inbound++;
  }
  if (parsed.receipts.length) {
    await withOrg(db, orgId, async (tx) => {
      for (const r of parsed.receipts) {
        const set =
          r.status === 'delivered'
            ? { deliveredAt: r.at }
            : r.status === 'read'
              ? { readAt: r.at }
              : r.status === 'failed'
                ? { status: 'failed', error: r.error }
                : null;
        if (!set) continue;
        const rows = await tx
          .update(messages)
          .set(set)
          .where(and(eq(messages.providerMessageId, r.id), eq(messages.status, 'sent')))
          .returning({ id: messages.id });
        out.receipts += rows.length;
      }
    });
  }
  return out;
}
