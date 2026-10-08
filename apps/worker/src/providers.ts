import { FakeParentBotModel } from '@rswim/domain-copilot';
import {
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
} from '@rswim/integrations';

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
