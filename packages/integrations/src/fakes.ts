/**
 * In-memory providers for tests, local demos and CI (`RSWIM_GROW_FAKE=1`, `RSWIM_INVOICING_FAKE=1`). They never talk
 * to a network. Ids derive from the idempotency key, so a retried call returns what the first one did.
 */
import { createHash } from 'node:crypto';
import type { Agorot } from '@rswim/money';
import type {
  ChargeResult,
  FiscalLine,
  InvoicingProvider,
  PaymentLinkRequest,
  PaymentProvider,
  ProviderContext,
} from './index';

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export interface FakePaymentCall {
  op: 'charge' | 'link' | 'mandate' | 'cancelMandate' | 'refund';
  ctx: ProviderContext;
  req: unknown;
}

/**
 * A fake Grow. A charge succeeds unless the mandate id contains "fail" (or `failNext` is set), so the demo seed can
 * hold a card that is declined.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly calls: FakePaymentCall[] = [];
  failNext = 0;
  /** Answer charges with `pending`, as Grow does when the result comes by webhook. */
  pending = false;
  private readonly charges = new Map<string, ChargeResult>();

  async chargeStandingOrder(
    ctx: ProviderContext,
    req: { mandateId: string; amount: Agorot; description: string },
  ): Promise<ChargeResult> {
    this.calls.push({ op: 'charge', ctx, req });
    const seen = this.charges.get(ctx.idempotencyKey);
    if (seen) return seen;
    const fail = this.failNext > 0 || req.mandateId.includes('fail');
    if (this.failNext > 0) this.failNext--;
    const result: ChargeResult = this.pending
      ? { externalPaymentId: `fake_pay_${short(ctx.idempotencyKey)}`, status: 'pending' }
      : fail
        ? {
            externalPaymentId: `fake_pay_${short(ctx.idempotencyKey)}`,
            status: 'failed',
            failureReason: 'card_declined',
          }
        : { externalPaymentId: `fake_pay_${short(ctx.idempotencyKey)}`, status: 'succeeded' };
    this.charges.set(ctx.idempotencyKey, result);
    return result;
  }

  async createPaymentLink(ctx: ProviderContext, req: PaymentLinkRequest) {
    this.calls.push({ op: 'link', ctx, req });
    const id = `fake_link_${short(ctx.idempotencyKey)}`;
    return { url: `https://pay.example.test/${id}`, externalId: id };
  }

  async createStandingOrder(
    ctx: ProviderContext,
    req: { householdId: string; amount: Agorot; dayOfMonth: number },
  ) {
    this.calls.push({ op: 'mandate', ctx, req });
    return { mandateId: `fake_mandate_${short(ctx.idempotencyKey)}` };
  }

  async cancelStandingOrder(ctx: ProviderContext, mandateId: string) {
    this.calls.push({ op: 'cancelMandate', ctx, req: { mandateId } });
  }

  async refund(ctx: ProviderContext, req: { externalPaymentId: string; amount: Agorot }) {
    this.calls.push({ op: 'refund', ctx, req });
    return { externalRefundId: `fake_refund_${short(ctx.idempotencyKey)}` };
  }
}

export interface FakeInvoice {
  kind?: 'invoice_receipt' | 'tax_invoice' | 'receipt';
  ctx: ProviderContext;
  client: { name: string; nationalId?: string; email?: string };
  lines: FiscalLine[];
  paymentMethod: string;
  notes?: string;
  documentId: string;
  number: string;
}

/** A fake Green Invoice: numbers documents in order and remembers exactly what it was asked to print. */
export class FakeInvoicingProvider implements InvoicingProvider {
  readonly issued: FakeInvoice[] = [];
  private next = 10_001;

  async issueInvoiceReceipt(
    ctx: ProviderContext,
    req: {
      client: { name: string; nationalId?: string; email?: string };
      lines: FiscalLine[];
      paymentMethod: string;
      notes?: string;
    },
  ) {
    const seen = this.issued.find((d) => d.ctx.idempotencyKey === ctx.idempotencyKey);
    const doc = seen ?? {
      ctx,
      ...req,
      documentId: `fake_doc_${short(ctx.idempotencyKey)}`,
      number: String(this.next++),
    };
    if (!seen) this.issued.push(doc);
    return {
      documentId: doc.documentId,
      number: doc.number,
      pdfUrl: `https://docs.example.test/${doc.documentId}.pdf`,
    };
  }

  private remember(ctx: ProviderContext, doc: Omit<FakeInvoice, 'ctx' | 'documentId' | 'number'>) {
    const seen = this.issued.find((d) => d.ctx.idempotencyKey === ctx.idempotencyKey);
    const out = seen ?? {
      ctx,
      ...doc,
      documentId: `fake_doc_${short(ctx.idempotencyKey)}`,
      number: String(this.next++),
    };
    if (!seen) this.issued.push(out);
    return {
      documentId: out.documentId,
      number: out.number,
      pdfUrl: `https://docs.example.test/${out.documentId}.pdf`,
    };
  }

  async issueTaxInvoice(
    ctx: ProviderContext,
    req: {
      client: { name: string; nationalId?: string; email?: string };
      lines: FiscalLine[];
      dueOn: string;
      notes?: string;
    },
  ) {
    return this.remember(ctx, {
      kind: 'tax_invoice',
      client: req.client,
      lines: req.lines,
      paymentMethod: 'later',
      notes: req.notes ?? `due ${req.dueOn}`,
    });
  }

  async issueReceipt(
    ctx: ProviderContext,
    req: {
      client: { name: string; nationalId?: string; email?: string };
      invoiceDocumentId: string;
      amount: Agorot;
      paymentMethod: string;
    },
  ) {
    return this.remember(ctx, {
      kind: 'receipt',
      client: req.client,
      lines: [{ description: req.invoiceDocumentId, amount: req.amount, quantity: 1 }],
      paymentMethod: req.paymentMethod,
    });
  }

  async issueCreditNote(
    ctx: ProviderContext,
    req: { originalDocumentId: string; lines: FiscalLine[] },
  ) {
    void req;
    return { documentId: `fake_credit_${short(ctx.idempotencyKey)}`, number: String(this.next++) };
  }
}
