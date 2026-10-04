import {
  ClaudeTriageClassifier,
  FakeInvoicingProvider,
  FakePaymentProvider,
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
