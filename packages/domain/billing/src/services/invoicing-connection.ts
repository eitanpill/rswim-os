/**
 * Where the business's receipts come from, chosen in-app by the owner: its own Morning account (docs/payments/MORNING.md),
 * whose API key is sealed with the organization's data key and never shown again, or its connected payment processor's
 * own documents (docs/payments/DOCUMENTS.md), opened with the processor's sealed credentials. One source per business,
 * so a payment never gets two documents. Only the tenant's system role (the worker) opens the credentials.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  InvoicingProviderKind,
  type InvoicingProviderKind as Kind,
  type PaymentGatewayKind,
} from '@rswim/contracts';
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
  processorIssuesDocuments,
  type GatewayCredentials,
  type InvoicingCredentials,
  type InvoicingProvider,
} from '@rswim/integrations';
import { paymentConnection } from './gateway';

const { invoicingConnections } = schema;

/** A receipts provider that can also prove its key works. */
export type ConnectedInvoicing = InvoicingProvider & {
  testConnection(): Promise<{ ok: true } | { ok: false; reason: string }>;
};

/** Builds the provider from plain credentials (`createInvoicing` from @rswim/integrations, or a test double). */
export type InvoicingFactory = (kind: 'morning', creds: InvoicingCredentials) => ConnectedInvoicing;

/**
 * Builds the processor's own documents from its sealed credentials (`processorInvoicing` from @rswim/integrations, or a
 * test double). Throws `InvoicingNotLiveError` while the processor's document adapter is not live.
 */
export type ProcessorInvoicingFactory = (
  kind: PaymentGatewayKind,
  creds: GatewayCredentials,
) => InvoicingProvider;

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
  opts: { build: InvoicingFactory; processorLive?: (kind: PaymentGatewayKind) => boolean },
) {
  const input = InvoicingConnectionInput.parse(raw);
  const dek = await orgDataKey(tx, ctx.orgId);
  if (!dek) throw new DomainError('payments.errors.noMasterKey');

  let status: 'connected' | 'failed' = 'connected';
  let error: string | null = null;
  const creds: InvoicingCredentials = {};
  let hints: Record<string, string>;
  if (input.provider === 'processor') {
    // The processor's own documents: no key of its own, it uses the connected processor's credentials.
    const gateway = await paymentConnection(tx);
    if (!gateway || gateway.status !== 'connected')
      throw new DomainError('receipts.errors.processorNotConnected');
    if (!processorIssuesDocuments(gateway.provider))
      throw new DomainError('receipts.errors.processorNoDocuments');
    if (!(opts.processorLive?.(gateway.provider) ?? false)) {
      status = 'failed';
      error = 'adapter_not_live';
    }
    hints = { processor: gateway.provider };
  } else {
    for (const f of INVOICING_FIELDS[input.provider]) creds[f.key] = input.credentials[f.key] ?? '';
    const bad = invalidInvoicingField(input.provider, creds);
    if (bad) throw new DomainError('receipts.errors.field', { field: bad });
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
    hints = invoicingHints(input.provider, creds);
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
    credentialHints: hints,
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
  return { id: rowId, provider: input.provider, status, error };
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

/**
 * The tenant's receipts, opened as its system role (the worker). Null when nothing was ever chosen. With the
 * processor's own documents, it follows the processor connection: a disconnected processor issues nothing.
 */
export async function loadInvoicing(
  tx: Tx,
  orgId: string,
  opts: { build: InvoicingFactory; buildProcessor?: ProcessorInvoicingFactory },
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
  try {
    if (row.provider === 'processor') {
      const g = await tx.execute<{
        id: string;
        provider: PaymentGatewayKind;
        status: string;
        c: Buffer;
      }>(
        sql`select id, provider, status, enc_credentials as c
            from payment_connections where organization_id = ${orgId}`,
      );
      const gw = g.rows[0];
      if (!gw || gw.status !== 'connected')
        return { provider: row.provider, invoicing: null, reason: 'disconnected' };
      if (!opts.buildProcessor)
        return { provider: row.provider, invoicing: null, reason: 'adapter_not_live' };
      const gcreds = JSON.parse(
        decryptField(dek, gw.c, {
          table: 'payment_connections',
          column: 'enc_credentials',
          rowId: gw.id,
        }),
      ) as GatewayCredentials;
      return {
        provider: row.provider,
        invoicing: opts.buildProcessor(gw.provider, gcreds),
        reason: null,
      };
    }
    const creds = JSON.parse(decryptField(dek, row.c, enc(row.id))) as InvoicingCredentials;
    return { provider: row.provider, invoicing: opts.build(row.provider, creds), reason: null };
  } catch (e) {
    if (e instanceof InvoicingNotLiveError)
      return { provider: row.provider, invoicing: null, reason: 'adapter_not_live' };
    throw e;
  }
}
