/**
 * WhatsApp through the business's own GHL sub-account (the GHL bridge). The number stays in GHL, where the business
 * already has it; we never talk to Meta. The owner enters the sub-account's location id and a Private Integration
 * token (sealed with the org's data key, never shown again) and adds one workflow in GHL: "Customer replied" on
 * WhatsApp → a webhook to the connection's hook URL. The hook only tells us *which contact* wrote; the worker then reads
 * that conversation from GHL's API with the business's own token, so a forged call can at most make us read our own
 * data. People's messages go into the inbox (and to the bots) once by GHL's id; answers someone else wrote in GHL (a
 * person, or the old GHL bot) are kept on the log, and in live mode give that conversation to a person.
 *
 * shadow mode (the default) lets the bots read everything and write their answers as suggestions that a person sends
 * or drops on the conversations screen; nothing a bot writes goes out alone, and the brain's actions from WhatsApp
 * wait for the owner. live lets them answer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  GhlBridgeConnectInput,
  GhlBridgeModeInput,
  toE164IL,
  type GhlBridgeMode,
} from '@rswim/contracts';
import { and, eq, gte, inArray, schema, sql, type Tx } from '@rswim/db';
import {
  decryptField,
  DomainError,
  emit,
  encryptField,
  orgDataKey,
  type ServiceContext,
} from '@rswim/domain-core';
import { ghlSettings, saveGhlLocation } from '@rswim/domain-crm';
import type { GhlBridgeClient } from '@rswim/integrations';
import { ghlPullPlan, type GhlPullPlan } from '../policies';
import { intakeInbound } from './inbox';

const { ghlConnections, chatHolds, inboundMessages, messages } = schema;

export const GHL_BRIDGE_CHECK_REQUESTED = 'comms.ghl_bridge_check_requested';
export const GHL_BRIDGE_PULL_REQUESTED = 'comms.ghl_bridge_pull_requested';

const enc = (rowId: string) => ({ table: 'ghl_connections', column: 'enc_token', rowId });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Whether the platform gave this business the bridge (`org_subscriptions.extras`). It is not a plan feature and not
 * offered to owners: without it the WhatsApp page shows no bridge and the database hides any connection.
 */
export async function ghlBridgeAllowed(tx: Tx): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(
    sql`select app.has_extra(app.current_org(), 'ghl_bridge') as ok`,
  );
  return r.rows[0]?.ok === true;
}

/** The bridge as the owner and the office see it: never its token. */
export async function ghlBridge(tx: Tx) {
  const [row] = await tx
    .select({
      id: ghlConnections.id,
      status: ghlConnections.status,
      mode: ghlConnections.mode,
      locationId: ghlConnections.locationId,
      hookToken: ghlConnections.hookToken,
      locationName: ghlConnections.locationName,
      checkedAt: ghlConnections.checkedAt,
      checkError: ghlConnections.checkError,
      lastInboundAt: ghlConnections.lastInboundAt,
      lastError: ghlConnections.lastError,
      foreignReplies: ghlConnections.foreignReplies,
      lastForeignAt: ghlConnections.lastForeignAt,
      connectedAt: ghlConnections.connectedAt,
      updatedAt: ghlConnections.updatedAt,
    })
    .from(ghlConnections);
  return row ? { ...row, mode: row.mode as GhlBridgeMode } : null;
}
export type GhlBridgeView = NonNullable<Awaited<ReturnType<typeof ghlBridge>>>;

/** The hook GHL's workflow calls: the connection and its secret token in the path. */
export const ghlBridgeHookPath = (b: { id: string; hookToken: string }) =>
  `/api/webhooks/ghl/bridge/${b.id}/${b.hookToken}`;

/**
 * The owner connects (or replaces) the sub-account. The token is sealed; the hook token is kept when the connection
 * already had one (GHL's workflow keeps working), and a new connection starts in shadow mode. The location id also
 * becomes the school's GHL location for contacts and pipelines. The worker then checks the token.
 */
export async function connectGhlBridge(tx: Tx, ctx: ServiceContext, raw: GhlBridgeConnectInput) {
  const input = GhlBridgeConnectInput.parse(raw);
  if (!(await ghlBridgeAllowed(tx))) throw new DomainError('ghlBridge.errors.notAllowed');
  const dek = await orgDataKey(tx, ctx.orgId);
  if (!dek) throw new DomainError('ghlBridge.errors.noMasterKey');
  const [existing] = await tx
    .select({ id: ghlConnections.id, hookToken: ghlConnections.hookToken })
    .from(ghlConnections)
    .where(eq(ghlConnections.organizationId, ctx.orgId));
  const rowId = existing?.id ?? randomUUID();
  const values = {
    status: 'connected',
    locationId: input.locationId,
    encToken: encryptField(dek, input.token, enc(rowId)),
    locationName: null,
    checkedAt: null,
    checkError: null,
    lastError: null,
    connectedBy: ctx.userId,
  };
  if (existing) {
    const rows = await tx
      .update(ghlConnections)
      .set(values)
      .where(eq(ghlConnections.id, rowId))
      .returning({ id: ghlConnections.id });
    if (!rows.length) throw new DomainError('ghlBridge.errors.ownerOnly');
  } else {
    await tx.insert(ghlConnections).values({
      id: rowId,
      organizationId: ctx.orgId,
      mode: 'shadow',
      hookToken: randomBytes(24).toString('hex'),
      connectedAt: new Date(),
      ...values,
    });
  }
  const current = await ghlSettings(tx, ctx.orgId);
  await saveGhlLocation(tx, ctx, input.locationId, current?.tagMap ?? {});
  await emitCheck(tx, ctx.orgId, rowId);
  return { id: rowId };
}

async function emitCheck(tx: Tx, orgId: string, connectionId: string) {
  await emit(tx, {
    organizationId: orgId,
    type: GHL_BRIDGE_CHECK_REQUESTED,
    payload: { connectionId },
    idempotencyKey: `${GHL_BRIDGE_CHECK_REQUESTED}:${connectionId}:${randomUUID()}`,
  });
}

/** The owner's connected bridge, updated, or a refusal: only the owner's update reaches the row (RLS). */
async function ownBridge(tx: Tx, set: Partial<typeof ghlConnections.$inferInsert>) {
  const [row] = await tx
    .update(ghlConnections)
    .set(set)
    .where(eq(ghlConnections.status, 'connected'))
    .returning({ id: ghlConnections.id });
  if (!row) throw new DomainError('ghlBridge.errors.notConnected');
  return row.id;
}

/** "Check the connection" again: the worker reads the sub-account with the token. */
export async function requestGhlBridgeCheck(tx: Tx, ctx: ServiceContext) {
  const id = await ownBridge(tx, { checkedAt: null, checkError: null });
  await emitCheck(tx, ctx.orgId, id);
}

/**
 * Shadow (bots suggest) or live (bots answer). Going live is refused until the token checked out; each switch starts
 * the count of someone else's answers again, so the owner sees whether the old GHL bot is still on.
 */
export async function setGhlBridgeMode(tx: Tx, raw: GhlBridgeModeInput) {
  const { mode } = GhlBridgeModeInput.parse(raw);
  const view = await ghlBridge(tx);
  if (!view || view.status !== 'connected') throw new DomainError('ghlBridge.errors.notConnected');
  if (mode === 'live' && (!view.checkedAt || view.checkError))
    throw new DomainError('ghlBridge.errors.checkFirst');
  await ownBridge(tx, { mode, foreignReplies: 0, lastForeignAt: null });
}

/** Switches the bridge off: nothing more is read from GHL; sending falls back to the school's other route. */
export async function disconnectGhlBridge(tx: Tx) {
  await ownBridge(tx, { status: 'disconnected', mode: 'shadow' });
}

/** The bridge's mode while it is connected, or null (no bridge). Bots and the brain ask before acting. */
export async function ghlBridgeMode(tx: Tx): Promise<GhlBridgeMode | null> {
  const r = await tx.execute<{ mode: GhlBridgeMode }>(
    sql`select mode from ghl_connections where status = 'connected' limit 1`,
  );
  return r.rows[0]?.mode ?? null;
}

export interface LoadedGhlBridge {
  connectionId: string;
  locationId: string;
  token: string;
  mode: GhlBridgeMode;
  connectedAt: Date;
}

/** The tenant's connected bridge with its token, opened as its system role (the worker). */
export async function loadGhlBridge(tx: Tx, orgId: string): Promise<LoadedGhlBridge | null> {
  const r = await tx.execute<{
    id: string;
    location_id: string;
    mode: GhlBridgeMode;
    connected_at: Date | string;
    t: Buffer;
  }>(
    sql`select id, location_id, mode, connected_at, enc_token t from ghl_connections
        where organization_id = ${orgId} and status = 'connected'`,
  );
  const row = r.rows[0];
  if (!row) return null;
  const dek = await orgDataKey(tx, orgId);
  if (!dek) throw new DomainError('ghlBridge.errors.noMasterKey');
  return {
    connectionId: row.id,
    locationId: row.location_id,
    token: decryptField(dek, row.t, enc(row.id)),
    mode: row.mode,
    connectedAt: new Date(row.connected_at),
  };
}

/** The worker's check: GHL answers for the location with the token, or says why not. */
export async function runGhlBridgeCheck(
  tx: Tx,
  bridge: LoadedGhlBridge,
  client: GhlBridgeClient,
): Promise<'ok' | 'failed'> {
  try {
    const loc = await client.location();
    await tx
      .update(ghlConnections)
      .set({ locationName: loc.name || null, checkedAt: new Date(), checkError: null })
      .where(eq(ghlConnections.id, bridge.connectionId));
    return 'ok';
  } catch (e) {
    await tx
      .update(ghlConnections)
      .set({ checkedAt: new Date(), checkError: errorText(e) })
      .where(eq(ghlConnections.id, bridge.connectionId));
    return 'failed';
  }
}

/** A send through GHL that GHL refused: kept on the bridge, so the owner sees why. */
export async function recordGhlBridgeError(tx: Tx, error: string | null) {
  await tx
    .update(ghlConnections)
    .set({ lastError: error ? error.slice(0, 500) : null })
    .where(eq(ghlConnections.status, 'connected'));
}

// ─── The worker's read ──────────────────────────────────────────────────────

export interface GhlPullResult {
  inbound: number;
  duplicates: number;
  foreign: number;
  foreignReplies: number;
  deferred: number;
  /** The contact has no phone GHL would tell us, or GHL refused. */
  skipped?: 'no_phone' | 'ghl_error';
}

/**
 * Reads one contact's conversation from GHL and applies the plan (`ghlPullPlan`): the person's new WhatsApp messages
 * into the inbox, someone else's answers onto the log (a reply in live mode gives the conversation to a person).
 */
export async function runGhlBridgePull(
  tx: Tx,
  ctx: ServiceContext,
  bridge: LoadedGhlBridge,
  client: GhlBridgeClient,
  contactId: string,
  now: Date = new Date(),
): Promise<GhlPullResult & { plan?: GhlPullPlan }> {
  const out: GhlPullResult = {
    inbound: 0,
    duplicates: 0,
    foreign: 0,
    foreignReplies: 0,
    deferred: 0,
  };
  let list;
  let rawPhone;
  try {
    [list, rawPhone] = await Promise.all([
      client.recentMessages(contactId, 20),
      client.contactPhone(contactId),
    ]);
  } catch (e) {
    await tx
      .update(ghlConnections)
      .set({ lastError: errorText(e) })
      .where(eq(ghlConnections.id, bridge.connectionId));
    return { ...out, skipped: 'ghl_error' };
  }
  const phone = rawPhone ? toE164IL(rawPhone) : null;
  if (!phone) return { ...out, skipped: 'no_phone' };
  const ids = list.map((m) => m.id);
  const known = new Set<string>();
  if (ids.length) {
    const ins = await tx
      .select({ id: inboundMessages.externalId })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.provider, 'ghl'), inArray(inboundMessages.externalId, ids)));
    const outs = await tx
      .select({ id: messages.providerMessageId })
      .from(messages)
      .where(inArray(messages.providerMessageId, ids));
    for (const r of [...ins, ...outs]) if (r.id) known.add(r.id);
  }
  const ours = await tx
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.toPhoneE164, phone),
        inArray(messages.status, ['queued', 'sent']),
        gte(messages.createdAt, new Date(now.getTime() - 24 * 3600_000)),
        sql`${messages.sourceEventType} is distinct from 'ghl.foreign'`,
      ),
    );
  const plan = ghlPullPlan({
    messages: list,
    known,
    ourTexts: new Set(ours.map((m) => (m.body ?? '').trim()).filter(Boolean)),
    connectedAt: bridge.connectedAt,
    now,
  });
  out.deferred = plan.deferred;
  for (const m of plan.inbound) {
    const r = await intakeInbound(tx, ctx, {
      provider: 'ghl',
      externalId: m.id,
      phoneE164: phone,
      ghlContactId: contactId,
      body: m.body,
      receivedAt: m.at,
    });
    if (r.outcome === 'duplicate') out.duplicates++;
    else out.inbound++;
  }
  if (plan.inbound.length)
    await tx
      .update(ghlConnections)
      .set({ lastInboundAt: plan.inbound.at(-1)?.at ?? now })
      .where(eq(ghlConnections.id, bridge.connectionId));
  for (const m of plan.foreign) {
    const [row] = await tx
      .insert(messages)
      .values({
        organizationId: ctx.orgId,
        toPhoneE164: phone,
        templateKey: 'free_text',
        body: m.body,
        status: 'sent',
        sentAt: m.at,
        notBefore: m.at,
        createdAt: m.at,
        providerMessageId: m.id,
        sourceEventType: 'ghl.foreign',
        idempotencyKey: `ghl.foreign:${m.id}`,
        explanation: {
          code: m.reply ? 'ghl_bridge.foreign_reply' : 'ghl_bridge.foreign',
          params: {},
        },
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (!row) continue;
    out.foreign++;
    if (!m.reply) continue;
    out.foreignReplies++;
    await tx
      .update(ghlConnections)
      .set({
        foreignReplies: sql`${ghlConnections.foreignReplies} + 1`,
        lastForeignAt: m.at,
      })
      .where(eq(ghlConnections.id, bridge.connectionId));
    // Someone else is answering this person: in live mode the bots step back, so nobody hears two answers.
    if (bridge.mode === 'live')
      await tx
        .insert(chatHolds)
        .values({ organizationId: ctx.orgId, phoneE164: phone, takenBy: null })
        .onConflictDoNothing();
  }
  return { ...out, plan };
}
