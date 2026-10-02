/**
 * Provider interfaces (brief §4.2). Adapters (GHL, Grow, Green Invoice, WhatsApp Cloud API) implement these
 * in later phases, so a tenant can swap providers without touching domain code.
 * Every call takes an idempotency key: adapters must make retries safe.
 */
import type { Agorot } from '@rswim/money';

export interface ProviderContext {
  organizationId: string;
  idempotencyKey: string;
}

// ─── Messaging (Phase 5): WhatsApp via GHL now, Cloud API later ──────────────
export interface OutboundMessage {
  toPhoneE164: string;
  /** Approved template for messages outside the 24h window; free text inside it. */
  template?: { id: string; variables: Record<string, string> };
  text?: string;
  locale: 'he' | 'en';
}
export interface MessagingProvider {
  send(ctx: ProviderContext, message: OutboundMessage): Promise<{ providerMessageId: string }>;
}

// ─── Payments (Phase 4): Grow (Meshulam) ─────────────────────────────────────
export interface PaymentLinkRequest {
  householdId: string;
  amount: Agorot;
  description: string;
  /** Printed on the link, e.g. how a trial fee is offset (brief §1.3). */
  termsText?: string;
}
export interface PaymentProvider {
  createPaymentLink(
    ctx: ProviderContext,
    req: PaymentLinkRequest,
  ): Promise<{ url: string; externalId: string }>;
  createStandingOrder(
    ctx: ProviderContext,
    req: { householdId: string; amount: Agorot; dayOfMonth: number },
  ): Promise<{ mandateId: string }>;
  cancelStandingOrder(ctx: ProviderContext, mandateId: string): Promise<void>;
  refund(
    ctx: ProviderContext,
    req: { externalPaymentId: string; amount: Agorot },
  ): Promise<{ externalRefundId: string }>;
}

// ─── Invoicing (Phase 4): Green Invoice / iCount ─────────────────────────────
export interface FiscalLine {
  description: string;
  amount: Agorot;
  quantity: number;
}
export interface InvoicingProvider {
  issueInvoiceReceipt(
    ctx: ProviderContext,
    req: {
      client: { name: string; nationalId?: string; email?: string };
      lines: FiscalLine[];
      paymentMethod: string;
      notes?: string;
    },
  ): Promise<{ documentId: string; number: string; pdfUrl: string }>;
  issueCreditNote(
    ctx: ProviderContext,
    req: { originalDocumentId: string; lines: FiscalLine[] },
  ): Promise<{ documentId: string; number: string }>;
}

// ─── CRM (Phase 1/5): GoHighLevel ─────────────────────────────────────────────
export interface CrmContact {
  externalId?: string;
  firstName: string;
  lastName: string;
  phoneE164?: string;
  email?: string;
  tags: string[];
  customFields: Record<string, string>;
}
export interface CrmProvider {
  upsertContact(ctx: ProviderContext, contact: CrmContact): Promise<{ externalId: string }>;
  moveOpportunity(
    ctx: ProviderContext,
    req: { contactExternalId: string; pipelineId: string; stageId: string },
  ): Promise<void>;
}
