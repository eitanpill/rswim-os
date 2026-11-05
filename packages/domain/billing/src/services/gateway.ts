/**
 * The business's own payment processor, connected in-app by the owner (docs/PAYMENTS.md). Credentials are sealed with
 * the organization's data key before they reach the database and are never shown again; only the tenant's system role
 * opens them, to build the gateway that charges, refunds and opens checkouts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CheckoutMethod,
  PaymentGatewayKind,
  type CheckoutMethod as Method,
  type PaymentGatewayKind as Kind,
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
  credentialHints,
  GatewayNotLiveError,
  invalidCredentialField,
  PAYMENT_GATEWAYS,
  type GatewayCredentials,
  type PaymentGateway,
} from '@rswim/integrations';

const { paymentConnections } = schema;

/** Builds a gateway from plain credentials (`createGateway` from @rswim/integrations, or a test double). */
export type GatewayFactory = (
  kind: Kind,
  creds: GatewayCredentials,
  opts: { webhookSecret: string },
) => PaymentGateway;

export const ConnectionInput = z.object({
  provider: PaymentGatewayKind,
  methods: z.array(CheckoutMethod).min(1, 'payments.errors.noMethod'),
  credentials: z.record(z.string(), z.string().trim()),
});
export type ConnectionInput = z.input<typeof ConnectionInput>;

const enc = (table: string, column: string, rowId: string) => ({ table, column, rowId });

/** The connection as the owner and office see it: never its secrets. */
export async function paymentConnection(tx: Tx) {
  const [row] = await tx
    .select({
      id: paymentConnections.id,
      provider: paymentConnections.provider,
      status: paymentConnections.status,
      methods: paymentConnections.methods,
      credentialHints: paymentConnections.credentialHints,
      lastCheckedAt: paymentConnections.lastCheckedAt,
      lastCheckError: paymentConnections.lastCheckError,
      updatedAt: paymentConnections.updatedAt,
    })
    .from(paymentConnections);
  if (!row) return null;
  return {
    ...row,
    provider: row.provider as Kind,
    methods: row.methods as Method[],
    credentialHints: row.credentialHints as Record<string, string>,
  };
}
export type PaymentConnectionView = NonNullable<Awaited<ReturnType<typeof paymentConnection>>>;

/**
 * The owner connects (or replaces) the processor: every credential field is entered again, checked by the processor
 * with a harmless call, and sealed. A processor whose adapter is not live yet is saved as `failed` with the reason,
 * so the owner sees it and nothing is ever charged through it.
 */
export async function connectPaymentGateway(
  tx: Tx,
  ctx: ServiceContext,
  raw: ConnectionInput,
  opts: { build: GatewayFactory; sandbox: boolean },
) {
  const input = ConnectionInput.parse(raw);
  const spec = PAYMENT_GATEWAYS[input.provider];
  if (input.provider === 'fake' && !opts.sandbox) throw new DomainError('payments.errors.demoOnly');
  if (input.methods.some((m) => !spec.methods.includes(m)))
    throw new DomainError('payments.errors.methodNotSupported');
  const creds: GatewayCredentials = {};
  for (const f of spec.fields) creds[f.key] = input.credentials[f.key] ?? '';
  const bad = invalidCredentialField(input.provider, creds);
  if (bad) throw new DomainError('payments.errors.field', { field: bad });

  const dek = await orgDataKey(tx, ctx.orgId);
  if (!dek) throw new DomainError('payments.errors.noMasterKey');
  const webhookSecret = randomBytes(32).toString('hex');

  let status: 'connected' | 'failed' = 'connected';
  let error: string | null = null;
  try {
    const check = await opts.build(input.provider, creds, { webhookSecret }).testConnection();
    if (!check.ok) {
      status = 'failed';
      error = check.reason;
    }
  } catch (e) {
    if (!(e instanceof GatewayNotLiveError)) throw e;
    status = 'failed';
    error = 'adapter_not_live';
  }

  const [existing] = await tx
    .select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(eq(paymentConnections.organizationId, ctx.orgId));
  const rowId = existing?.id ?? randomUUID();
  const values = {
    provider: input.provider,
    status,
    methods: input.methods,
    encCredentials: encryptField(
      dek,
      JSON.stringify(creds),
      enc('payment_connections', 'enc_credentials', rowId),
    ),
    encWebhookSecret: encryptField(
      dek,
      webhookSecret,
      enc('payment_connections', 'enc_webhook_secret', rowId),
    ),
    credentialHints: credentialHints(input.provider, creds),
    lastCheckedAt: new Date(),
    lastCheckError: error,
    connectedBy: ctx.userId,
  };
  if (existing) {
    await tx.update(paymentConnections).set(values).where(eq(paymentConnections.id, rowId));
  } else {
    await tx.insert(paymentConnections).values({ id: rowId, organizationId: ctx.orgId, ...values });
  }
  return { id: rowId, status, error };
}

/** Which ways customers may pay, without touching the credentials. */
export async function setPaymentMethods(tx: Tx, raw: unknown) {
  const methods = z.array(CheckoutMethod).min(1, 'payments.errors.noMethod').parse(raw);
  const current = await paymentConnection(tx);
  if (!current) throw new DomainError('payments.errors.notConnected');
  if (methods.some((m) => !PAYMENT_GATEWAYS[current.provider].methods.includes(m)))
    throw new DomainError('payments.errors.methodNotSupported');
  const rows = await tx
    .update(paymentConnections)
    .set({ methods })
    .where(eq(paymentConnections.id, current.id))
    .returning({ id: paymentConnections.id });
  if (rows.length === 0) throw new DomainError('payments.errors.ownerOnly');
}

/** Disconnects: customers stop seeing the pay buttons; standing orders already set up stay recorded. */
export async function disconnectPaymentGateway(tx: Tx) {
  const rows = await tx
    .update(paymentConnections)
    .set({ status: 'disconnected' })
    .returning({ id: paymentConnections.id });
  if (rows.length === 0) throw new DomainError('payments.errors.notConnected');
}

export interface LoadedGateway {
  connectionId: string;
  provider: Kind;
  methods: Method[];
  gateway: PaymentGateway | null;
  /** Why there is no gateway: disconnected, a failed check, or an adapter that is not live. */
  reason: 'disconnected' | 'failed' | 'adapter_not_live' | null;
}

/**
 * The tenant's gateway, opened as its system role (the worker, the checkout, the webhook). Null when the business
 * has no connection at all.
 */
export async function loadGateway(
  tx: Tx,
  orgId: string,
  opts: { build: GatewayFactory },
): Promise<LoadedGateway | null> {
  const r = await tx.execute<{
    id: string;
    provider: Kind;
    status: string;
    methods: Method[];
    c: Buffer;
    w: Buffer;
  }>(
    sql`select id, provider, status, methods, enc_credentials as c, enc_webhook_secret as w
        from payment_connections where organization_id = ${orgId}`,
  );
  const row = r.rows[0];
  if (!row) return null;
  const base = { connectionId: row.id, provider: row.provider, methods: row.methods };
  if (row.status !== 'connected')
    return { ...base, gateway: null, reason: row.status === 'failed' ? 'failed' : 'disconnected' };
  const dek = await orgDataKey(tx, orgId);
  if (!dek) throw new DomainError('payments.errors.noMasterKey');
  const creds = JSON.parse(
    decryptField(dek, row.c, enc('payment_connections', 'enc_credentials', row.id)),
  ) as GatewayCredentials;
  const webhookSecret = decryptField(
    dek,
    row.w,
    enc('payment_connections', 'enc_webhook_secret', row.id),
  );
  try {
    return { ...base, gateway: opts.build(row.provider, creds, { webhookSecret }), reason: null };
  } catch (e) {
    if (e instanceof GatewayNotLiveError)
      return { ...base, gateway: null, reason: 'adapter_not_live' };
    throw e;
  }
}
