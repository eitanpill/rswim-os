/**
 * The business's tax documents issued by its own payment processor instead of Morning (docs/payments/DOCUMENTS.md).
 * One source per business: the worker issues each payment's document through exactly one `InvoicingProvider`, and
 * checkouts never ask the processor for a document, so a payment never gets two.
 */
import type { PaymentGatewayKind } from '@rswim/contracts';
import { FakeInvoicingProvider } from './fakes';
import { type GatewayCredentials, PAYMENT_GATEWAYS } from './gateways';
import { InvoicingNotLiveError } from './morning';
import type { InvoicingProvider } from './index';

/** Whether this processor's API issues documents at all (offered on the receipts screen). */
export function processorIssuesDocuments(kind: PaymentGatewayKind): boolean {
  return PAYMENT_GATEWAYS[kind].documents === 'api';
}

/**
 * Whether the processor's document adapter may run in this process. None is live yet: each is written from the
 * processor's own API reference and switched on after a test in its sandbox (Cardcom once its CreateDocument schema is
 * confirmed; SUMIT and PayPlus with their adapters). Until then the choice is saved as "not live yet" and nothing is
 * issued through it.
 */
export function processorDocumentsLive(
  kind: PaymentGatewayKind,
  _env: Record<string, string | undefined> = process.env,
): boolean {
  void kind;
  return false;
}

/**
 * The processor's documents as the business's invoicing. In a sandboxed process (local, CI, the live demo) a fake
 * stands in for every processor that issues documents; otherwise one without a live document adapter throws
 * `InvoicingNotLiveError` and nothing is issued.
 */
export function processorInvoicing(
  kind: PaymentGatewayKind,
  _creds: GatewayCredentials,
  opts: { sandbox: boolean; env?: Record<string, string | undefined> },
): InvoicingProvider {
  if (!processorIssuesDocuments(kind)) throw new InvoicingNotLiveError(kind);
  if (opts.sandbox) return new FakeInvoicingProvider();
  throw new InvoicingNotLiveError(kind);
}
