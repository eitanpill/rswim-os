/**
 * The business's own WhatsApp number on Meta's Cloud API (WhatsApp track W5). The owner connects it with what Meta's
 * WhatsApp Manager shows (the number's id, the business account's id, an access token and the app secret); the token
 * and the secret are sealed with the organization's data key and never shown again. Meta's webhook names the
 * connection in its URL: the GET answers Meta's subscription check with the verify token, the POST is checked against
 * the app secret and brings the people's messages into the inbox (where the bots pick them up) and the receipts of
 * ours onto the message log.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { WhatsAppConnectInput, MetaTemplateInput, type TemplateKey } from '@rswim/contracts';
import { and, eq, schema, sql, type Tx } from '@rswim/db';
import {
  decryptField,
  DomainError,
  encryptField,
  orgDataKey,
  type ServiceContext,
} from '@rswim/domain-core';
import { metaParamsFrom } from '../policies';
import { ensureCommsDefaults } from './templates';

const { whatsappConnections, messageTemplates } = schema;

const enc = (column: string, rowId: string) => ({
  table: 'whatsapp_connections',
  column,
  rowId,
});

/** The connection as the owner and the office see it: never its secrets. */
export async function whatsappConnection(tx: Tx) {
  const [row] = await tx
    .select({
      id: whatsappConnections.id,
      status: whatsappConnections.status,
      phoneNumberId: whatsappConnections.phoneNumberId,
      businessAccountId: whatsappConnections.businessAccountId,
      displayPhone: whatsappConnections.displayPhone,
      verifyToken: whatsappConnections.verifyToken,
      lastInboundAt: whatsappConnections.lastInboundAt,
      lastError: whatsappConnections.lastError,
      updatedAt: whatsappConnections.updatedAt,
    })
    .from(whatsappConnections);
  return row ?? null;
}
export type WhatsAppConnectionView = NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;

/**
 * The owner connects (or replaces) the number. Every secret is entered again and sealed; the verify token is kept
 * when the connection already had one, so Meta's subscription keeps working.
 */
export async function connectWhatsApp(tx: Tx, ctx: ServiceContext, raw: WhatsAppConnectInput) {
  const input = WhatsAppConnectInput.parse(raw);
  const dek = await orgDataKey(tx, ctx.orgId);
  if (!dek) throw new DomainError('whatsapp.errors.noMasterKey');
  const [existing] = await tx
    .select({ id: whatsappConnections.id, verifyToken: whatsappConnections.verifyToken })
    .from(whatsappConnections)
    .where(eq(whatsappConnections.organizationId, ctx.orgId));
  const rowId = existing?.id ?? randomUUID();
  const values = {
    status: 'connected',
    phoneNumberId: input.phoneNumberId,
    businessAccountId: input.businessAccountId,
    displayPhone: input.displayPhone,
    verifyToken: existing?.verifyToken ?? randomBytes(24).toString('hex'),
    encAccessToken: encryptField(dek, input.accessToken, enc('enc_access_token', rowId)),
    encAppSecret: encryptField(dek, input.appSecret, enc('enc_app_secret', rowId)),
    lastError: null,
    connectedBy: ctx.userId,
  };
  try {
    if (existing) {
      const rows = await tx
        .update(whatsappConnections)
        .set(values)
        .where(eq(whatsappConnections.id, rowId))
        .returning({ id: whatsappConnections.id });
      if (!rows.length) throw new DomainError('whatsapp.errors.ownerOnly');
    } else {
      await tx
        .insert(whatsappConnections)
        .values({ id: rowId, organizationId: ctx.orgId, ...values });
    }
  } catch (e) {
    if (
      (e as { code?: string }).code === '23505' ||
      (e as { cause?: { code?: string } }).cause?.code === '23505'
    )
      throw new DomainError('whatsapp.errors.numberTaken');
    throw e;
  }
  return { id: rowId };
}

/** Switches the number off: messages go back to the business's other route (GHL), or wait. */
export async function disconnectWhatsApp(tx: Tx) {
  const rows = await tx
    .update(whatsappConnections)
    .set({ status: 'disconnected' })
    .returning({ id: whatsappConnections.id });
  if (rows.length === 0) throw new DomainError('whatsapp.errors.notConnected');
}

export interface LoadedWhatsApp {
  connectionId: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
}

/** The tenant's connected number with its secrets, opened as its system role (the worker, the webhook). */
export async function loadWhatsApp(tx: Tx, orgId: string): Promise<LoadedWhatsApp | null> {
  const r = await tx.execute<{ id: string; phone_number_id: string; t: Buffer; s: Buffer }>(
    sql`select id, phone_number_id, enc_access_token t, enc_app_secret s from whatsapp_connections
        where organization_id = ${orgId} and status = 'connected'`,
  );
  const row = r.rows[0];
  if (!row) return null;
  const dek = await orgDataKey(tx, orgId);
  if (!dek) throw new DomainError('whatsapp.errors.noMasterKey');
  return {
    connectionId: row.id,
    phoneNumberId: row.phone_number_id,
    accessToken: decryptField(dek, row.t, enc('enc_access_token', row.id)),
    appSecret: decryptField(dek, row.s, enc('enc_app_secret', row.id)),
  };
}

/** A send that Meta refused: kept on the connection, so the owner sees why on the connection page. */
export async function recordWhatsAppError(tx: Tx, error: string | null) {
  await tx
    .update(whatsappConnections)
    .set({ lastError: error ? error.slice(0, 500) : null })
    .where(eq(whatsappConnections.status, 'connected'));
}

/**
 * The approved Meta template for one message (key and language): its name in WhatsApp Manager and which of the
 * message's variables fill its {{1}}, {{2}}… An empty name removes it (the message then goes only inside the window).
 */
export async function setMetaTemplate(tx: Tx, ctx: ServiceContext, raw: MetaTemplateInput) {
  const input = MetaTemplateInput.parse(raw);
  await ensureCommsDefaults(tx, ctx.orgId);
  const [tpl] = await tx
    .select({ id: messageTemplates.id, body: messageTemplates.body })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, input.key as TemplateKey),
        eq(messageTemplates.locale, input.locale),
      ),
    );
  if (!tpl) throw new DomainError('common.errors.notFound');
  const params = input.metaName ? metaParamsFrom(input.metaParams, tpl.body) : null;
  if (params && !params.ok)
    throw new DomainError('whatsapp.errors.unknownVariable', { names: params.unknown.join(', ') });
  await tx
    .update(messageTemplates)
    .set({
      metaName: input.metaName || null,
      metaParams: params?.ok ? params.params : [],
      updatedBy: ctx.userId,
    })
    .where(eq(messageTemplates.id, tpl.id));
}
