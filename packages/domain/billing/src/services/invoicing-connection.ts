/**
 * The business's own receipts account (Morning), connected in-app by the owner (docs/payments/MORNING.md). The API
 * key is sealed with the organization's data key and never shown again; only the tenant's system role (the worker)
 * opens it to issue the business's receipts and invoices.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { InvoicingProviderKind, type InvoicingProviderKind as Kind } from '@rswim/contracts';
import { eq, schema, sql, type Tx } from '@rswim/db';
import {
  decryptField,
  DomainError,
  encryptField,
  orgDataKey,
  type ServiceContext,
} from '@rswim/domain-core';
import {
  INVOICING_FIELDS,
  InvoicingNotLiveError,
  invalidInvoicingField,
  invoicingHints,
  type InvoicingCredentials,
  type InvoicingProvider,
} from '@rswim/integrations';

const { invoicingConnections } = schema;

/** A receipts provider that can also prove its key works. */
export type ConnectedInvoicing = InvoicingProvider & {
  testConnection(): Promise<{ ok: true } | { ok: false; reason: string }>;
};

/** Builds the provider from plain credentials (`createInvoicing` from @rswim/integrations, or a test double). */
export type InvoicingFactory = (kind: Kind, creds: InvoicingCredentials) => ConnectedInvoicing;

export const InvoicingConnectionInput = z.object({
  provider: InvoicingProviderKind,
  credentials: z.record(z.string(), z.string().trim()),
});
export type InvoicingConnectionInput = z.input<typeof InvoicingConnectionInput>;

const enc = (rowId: string) => ({
  table: 'invoicing_connections',
  column: 'enc_credentials',
  rowId,
});

/** The connection as the owner, office and accountant see it: never its key. */
export async function invoicingConnection(tx: Tx) {
  const [row] = await tx
    .select({
      id: invoicingConnections.id,
      provider: invoicingConnections.provider,
      status: invoicingConnections.status,
      credentialHints: invoicingConnections.credentialHints,
      lastCheckedAt: invoicingConnections.lastCheckedAt,
      lastCheckError: invoicingConnections.lastCheckError,
      updatedAt: invoicingConnections.updatedAt,
    })
    .from(invoicingConnections);
  if (!row) return null;
  return {
    ...row,
    provider: row.provider as Kind,
    credentialHints: row.credentialHints as Record<string, string>,
  };
}
export type InvoicingConnectionView = NonNullable<Awaited<ReturnType<typeof invoicingConnection>>>;

/**
 * The owner connects (or replaces) the receipts account: both fields are entered again, the key is checked by asking
 * Morning for a token, and sealed. An adapter that is not live yet is saved as `failed` with the reason, so no document
 * is issued through it.
 */
export async function connectInvoicing(
  tx: Tx,
  ctx: ServiceContext,
  raw: InvoicingConnectionInput,
  opts: { build: InvoicingFactory },
) {
  const input = InvoicingConnectionInput.parse(raw);
  const creds: InvoicingCredentials = {};
  for (const f of INVOICING_FIELDS[input.provider]) creds[f.key] = input.credentials[f.key] ?? '';
  const bad = invalidInvoicingField(input.provider, creds);
  if (bad) throw new DomainError('receipts.errors.field', { field: bad });

  const dek = await orgDataKey(tx, ctx.orgId);
  if (!dek) throw new DomainError('payments.errors.noMasterKey');

  let status: 'connected' | 'failed' = 'connected';
  let error: string | null = null;
  try {
    const check = await opts.build(input.provider, creds).testConnection();
    if (!check.ok) {
      status = 'failed';
      error = check.reason;
    }
  } catch (e) {
    if (!(e instanceof InvoicingNotLiveError)) throw e;
    status = 'failed';
    error = 'adapter_not_live';
  }

  const [existing] = await tx
    .select({ id: invoicingConnections.id })
    .from(invoicingConnections)
    .where(eq(invoicingConnections.organizationId, ctx.orgId));
  const rowId = existing?.id ?? randomUUID();
  const values = {
    provider: input.provider,
    status,
    encCredentials: encryptField(dek, JSON.stringify(creds), enc(rowId)),
    credentialHints: invoicingHints(input.provider, creds),
    lastCheckedAt: new Date(),
    lastCheckError: error,
    connectedBy: ctx.userId,
  };
  if (existing) {
    await tx.update(invoicingConnections).set(values).where(eq(invoicingConnections.id, rowId));
  } else {
    await tx
      .insert(invoicingConnections)
      .values({ id: rowId, organizationId: ctx.orgId, ...values });
  }
  return { id: rowId, status, error };
}

/** Disconnects: no new documents are issued; the ones already issued stay where they are. */
export async function disconnectInvoicing(tx: Tx) {
  const rows = await tx
    .update(invoicingConnections)
    .set({ status: 'disconnected' })
    .returning({ id: invoicingConnections.id });
  if (rows.length === 0) throw new DomainError('receipts.errors.notConnected');
}

export interface LoadedInvoicing {
  provider: Kind;
  invoicing: InvoicingProvider | null;
  reason: 'disconnected' | 'failed' | 'adapter_not_live' | null;
}

/** The tenant's receipts provider, opened as its system role (the worker). Null when nothing was ever connected. */
export async function loadInvoicing(
  tx: Tx,
  orgId: string,
  opts: { build: InvoicingFactory },
): Promise<LoadedInvoicing | null> {
  const r = await tx.execute<{ id: string; provider: Kind; status: string; c: Buffer }>(
    sql`select id, provider, status, enc_credentials as c
        from invoicing_connections where organization_id = ${orgId}`,
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.status !== 'connected')
    return {
      provider: row.provider,
      invoicing: null,
      reason: row.status === 'failed' ? 'failed' : 'disconnected',
    };
  const dek = await orgDataKey(tx, orgId);
  if (!dek) throw new DomainError('payments.errors.noMasterKey');
  const creds = JSON.parse(decryptField(dek, row.c, enc(row.id))) as InvoicingCredentials;
  try {
    return { provider: row.provider, invoicing: opts.build(row.provider, creds), reason: null };
  } catch (e) {
    if (e instanceof InvoicingNotLiveError)
      return { provider: row.provider, invoicing: null, reason: 'adapter_not_live' };
    throw e;
  }
}
