import { loadGateway, loadInvoicing } from '@rswim/domain-billing';
import { withOrg } from '@rswim/db/service';
import { aiModelFor, type AiLevel } from '@rswim/contracts';
import { FakeCopilotModel, FakeParentBotModel } from '@rswim/domain-copilot';
import {
  CardcomPlatformProvider,
  createGateway,
  createInvoicing,
  invoicingLive,
  MorningInvoicing,
  platformMorningCredentials,
  gatewaySandbox,
  platformCardcomCredentials,
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
  ApnsPushProvider,
  FakePushProvider,
  FcmPushProvider,
  type FcmServiceAccount,
  PlatformPushProvider,
  type PushProvider,
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

let platformCharges: PaymentProvider | undefined;

/**
 * The platform's own processor: it charges the schools' subscription cards (never a school's customers).
 * - RSWIM_GROW_FAKE=1: the same in-memory provider as above (local, CI, the live demo).
 * - PLATFORM_CARDCOM_TERMINAL_NUMBER + PLATFORM_CARDCOM_API_NAME: the platform's Cardcom terminal.
 * Null otherwise: nothing is charged.
 */
export function platformPaymentProvider(): PaymentProvider | null {
  if (process.env.RSWIM_GROW_FAKE === '1') return paymentProvider();
  const creds = platformCardcomCredentials();
  if (!creds) return null;
  return (platformCharges ??= new CardcomPlatformProvider(creds));
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

/** The name stored on each document, so the portal knows a fake document has no real PDF behind it. */
export function invoicingProviderName(): string {
  return process.env.RSWIM_INVOICING_FAKE === '1' ? 'fake' : 'green_invoice';
}

/**
 * A business's receipts: its own Morning account when the owner connected one (/admin/integrations/receipts), or null
 * (the documents wait, nothing is issued in someone else's account).
 * - RSWIM_INVOICING_FAKE=1: an in-memory Morning that numbers documents from 10001 (local, CI, the live demo).
 * - A connected Morning runs only with RSWIM_MORNING_LIVE=1 (docs/payments/MORNING.md).
 */
export async function invoicingProvider(orgId: string): Promise<InvoicingProvider | null> {
  if (process.env.RSWIM_INVOICING_FAKE === '1') return (invoicing ??= new FakeInvoicingProvider());
  try {
    const loaded = await withOrg(getDb(), orgId, (tx) =>
      loadInvoicing(tx, orgId, { build: (kind, creds) => createInvoicing(kind, creds) }),
    );
    if (loaded && !loaded.invoicing)
      log.warn({ orgId, reason: loaded.reason }, 'receipts not usable');
    return loaded?.invoicing ?? null;
  } catch (e) {
    log.error({ orgId, err: e }, 'receipts could not be opened');
    return null;
  }
}

let platformDocs: InvoicingProvider | undefined;

/**
 * The platform's own invoicing (Morning, the platform owner's account): tax invoice-receipts to schools for their
 * subscription. Separate from any school's invoicing.
 * - RSWIM_INVOICING_FAKE=1: an in-memory Morning.
 * - PLATFORM_MORNING_API_KEY_ID + PLATFORM_MORNING_API_KEY_SECRET with RSWIM_MORNING_LIVE=1: the platform's Morning.
 */
export function platformInvoicing(): InvoicingProvider | null {
  if (process.env.RSWIM_INVOICING_FAKE === '1')
    return (platformDocs ??= new FakeInvoicingProvider());
  const creds = platformMorningCredentials();
  if (!creds || !invoicingLive('morning')) return null;
  return (platformDocs ??= new MorningInvoicing(creds, {
    sandbox: process.env.MORNING_SANDBOX === '1',
  }));
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

const botModels = new Map<string, CopilotModel>();

/** Whether a model can answer for the bot at all: the stand-in, or Claude's key. */
export function botConfigured(): boolean {
  return process.env.RSWIM_BOT_FAKE === '1' || Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The model behind the bot (families, leads, divers) at the level the business's owner picked, or null (the bot then
 * stays out of the way and the inbox works as before).
 * - RSWIM_BOT_FAKE=1: the rules-based stand-in, for demos and tests.
 * - ANTHROPIC_API_KEY: Claude with the bot's tools. The owner still has to turn on `comms.bot_enabled`.
 */
export function parentBotModel(level: AiLevel): CopilotModel | null {
  if (!botConfigured()) return null;
  const fake = process.env.RSWIM_BOT_FAKE === '1';
  const key = fake ? 'fake' : level;
  let model = botModels.get(key);
  if (!model) {
    model = fake
      ? new FakeParentBotModel()
      : new ClaudeCopilotModel({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: aiModelFor('parent_bot', level),
          maxTurns: 6,
        });
    botModels.set(key, model);
  }
  return model;
}

/**
 * The owner's assistant for her WhatsApp questions (brain-inbound, WhatsApp track W7), at her level: the rules-based
 * stand-in with RSWIM_COPILOT_FAKE=1, Claude with ANTHROPIC_API_KEY, otherwise none (her message stays in the inbox).
 */
export function ownerCopilotModel(level: AiLevel, today: string): CopilotModel | null {
  if (process.env.RSWIM_COPILOT_FAKE === '1') return new FakeCopilotModel(today);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new ClaudeCopilotModel({ apiKey, model: aiModelFor('copilot', level) }) : null;
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
    throw new Error(
      'SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_SLUG are needed to create a school database',
    );
  }
  return new SupabaseManagementHost({
    accessToken,
    organizationSlug,
    region: process.env.SUPABASE_REGION || undefined,
    instanceSize: process.env.SUPABASE_INSTANCE_SIZE || undefined,
  });
}

let pushProviderCache: PushProvider | null | undefined;

/**
 * Push notifications to the store app (store stage 6), or null while neither platform is set up (families then get
 * WhatsApp only). Keys live in the worker's environment, never the database or the repository:
 * - RSWIM_PUSH_FAKE=1: in-memory push for local demos and CI.
 * - FCM_SERVICE_ACCOUNT_JSON: the Firebase project's service account key (Android).
 * - APNS_KEY_P8 + APNS_KEY_ID (+ APNS_TEAM_ID, default the business's team; APNS_SANDBOX=1 for Xcode builds): the
 *   Apple Push Notifications key (iPhone).
 */
export function pushProvider(): PushProvider | null {
  if (pushProviderCache !== undefined) return pushProviderCache;
  if (process.env.RSWIM_PUSH_FAKE === '1') return (pushProviderCache = new FakePushProvider());
  const providers: PushProvider[] = [];
  const fcm = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (fcm) {
    try {
      providers.push(new FcmPushProvider(JSON.parse(fcm) as FcmServiceAccount));
    } catch {
      log.error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON; Android push is off');
    }
  }
  const p8 = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  if (p8 && keyId)
    providers.push(
      new ApnsPushProvider({
        keyP8: p8.replace(/\\n/g, '\n'),
        keyId,
        teamId: process.env.APNS_TEAM_ID ?? '6ZNNQLACFA',
        topic: 'il.co.aquaswim.app',
        sandbox: process.env.APNS_SANDBOX === '1',
      }),
    );
  return (pushProviderCache = providers.length ? new PlatformPushProvider(providers) : null);
}
