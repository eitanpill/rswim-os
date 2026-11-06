import { loadGateway } from '@rswim/domain-billing';
import { withOrg } from '@rswim/db/service';
import { FakeParentBotModel } from '@rswim/domain-copilot';
import {
  createGateway,
  gatewaySandbox,
  type PaymentGateway,
  ClaudeInsightWriter,
  ClaudeCopilotModel,
  ClaudeTriageClassifier,
  type CopilotModel,
  FakeInvoicingProvider,
  FakePaymentProvider,
  type InsightWriter,
  type InvoicingProvider,
  type PaymentProvider,
  type TriageClassifier,
  type DatabaseHost,
  LocalPostgresHost,
  SupabaseManagementHost,
} from '@rswim/integrations';

import { getDb, log } from './client';

let payments: FakePaymentProvider | undefined;
let invoicing: FakeInvoicingProvider | undefined;

/**
 * The payment provider (Grow), or null while none is set up.
 * - RSWIM_GROW_FAKE=1: an in-memory Grow for local demos and CI. A mandate id containing "fail" is declined.
 * The real Grow client arrives with the account's credentials (kept in the worker's environment, never the database).
 */
export function paymentProvider(): PaymentProvider | null {
  if (process.env.RSWIM_GROW_FAKE === '1') return (payments ??= new FakePaymentProvider());
  return null;
}

/**
 * The business's own processor when its owner connected one (/admin/integrations/payments), else the worker-wide
 * provider above. A business that connected a processor never falls back to the worker-wide one (that would move its
 * money through someone else's account): while its connection is not working, nothing is charged.
 */
export async function tenantPaymentProvider(orgId: string): Promise<PaymentProvider | null> {
  const loaded = await loadTenantGateway(orgId);
  if (loaded === 'none') return paymentProvider();
  return loaded;
}

/** The business's connected processor, or null (none connected, disconnected, or its adapter is not live). */
export async function tenantGateway(orgId: string): Promise<PaymentGateway | null> {
  const loaded = await loadTenantGateway(orgId);
  return loaded === 'none' ? null : loaded;
}

async function loadTenantGateway(orgId: string): Promise<PaymentGateway | null | 'none'> {
  const sandbox = gatewaySandbox();
  try {
    const loaded = await withOrg(getDb(), orgId, (tx) =>
      loadGateway(tx, orgId, {
        build: (kind, creds, o) => createGateway(kind, creds, { ...o, sandbox }),
      }),
    );
    if (!loaded) return 'none';
    if (!loaded.gateway) log.warn({ orgId, reason: loaded.reason }, 'payment gateway not usable');
    return loaded.gateway;
  } catch (e) {
    log.error({ orgId, err: e }, 'payment gateway could not be opened');
    return null;
  }
}

/** The web app's public address, for payment pages sent to customers (RSWIM_PUBLIC_URL). */
export function publicUrl(): string {
  return process.env.RSWIM_PUBLIC_URL ?? 'http://localhost:3000';
}

/**
 * The invoicing provider (Green Invoice), or null while none is set up.
 * - RSWIM_INVOICING_FAKE=1: an in-memory Green Invoice that numbers documents from 10001.
 */
/** The name stored on each document, so the portal knows a fake document has no real PDF behind it. */
export function invoicingProviderName(): string {
  return process.env.RSWIM_INVOICING_FAKE === '1' ? 'fake' : 'green_invoice';
}

export function invoicingProvider(): InvoicingProvider | null {
  if (process.env.RSWIM_INVOICING_FAKE === '1') return (invoicing ??= new FakeInvoicingProvider());
  return null;
}

let classifier: ClaudeTriageClassifier | undefined;

/**
 * The AI triage classifier, or null. Used only when the owner turns on `comms.ai_triage` and the worker has
 * ANTHROPIC_API_KEY; the rules classifier's verdict stands otherwise.
 */
export function triageClassifier(): TriageClassifier | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (classifier ??= new ClaudeTriageClassifier({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

let insights: ClaudeInsightWriter | undefined;

/**
 * Claude for the insights feed's notes, or null without ANTHROPIC_API_KEY (the feed then shows its built-in wording).
 * The `insights.ai_notes` policy can turn it off per school.
 */
export function insightWriter(): InsightWriter | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (insights ??= new ClaudeInsightWriter({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

let botModel: CopilotModel | undefined;

/**
 * The model behind the parents' bot, or null (the bot then stays out of the way and the inbox works as before).
 * - RSWIM_BOT_FAKE=1: the rules-based stand-in, for demos and tests.
 * - ANTHROPIC_API_KEY: Claude with the bot's read tools. The owner still has to turn on `comms.bot_enabled`.
 */
export function parentBotModel(): CopilotModel | null {
  if (process.env.RSWIM_BOT_FAKE === '1') return (botModel ??= new FakeParentBotModel());
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (botModel ??= new ClaudeCopilotModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTurns: 6,
  }));
}

/**
 * Where schools' own databases are created (docs/TENANT-DATABASES.md).
 * - 'supabase': the Supabase Management API with SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_SLUG (the platform's
 *   Supabase organization); SUPABASE_REGION (e.g. eu-central-1) and SUPABASE_INSTANCE_SIZE are optional.
 * - 'local': a database per school on the Postgres at RSWIM_TENANT_ADMIN_URL (default DATABASE_URL), for demos and
 *   tests. The role must be allowed to create databases.
 */
export function databaseHost(provider: string): DatabaseHost {
  if (provider === 'local') {
    const admin = process.env.RSWIM_TENANT_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!admin) throw new Error('RSWIM_TENANT_ADMIN_URL is not set');
    return new LocalPostgresHost(admin);
  }
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const organizationSlug = process.env.SUPABASE_ORG_SLUG;
  if (!accessToken || !organizationSlug) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_SLUG are needed to create a school database');
  }
  return new SupabaseManagementHost({
    accessToken,
    organizationSlug,
    region: process.env.SUPABASE_REGION || undefined,
    instanceSize: process.env.SUPABASE_INSTANCE_SIZE || undefined,
  });
}
