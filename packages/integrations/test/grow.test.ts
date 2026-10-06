import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  FakeInvoicingProvider,
  FakePaymentProvider,
  GrowWebhook,
  signGrowWebhook,
  verifyGrowSignature,
} from '../src';

const ctx = (key: string) => ({ organizationId: 'org', idempotencyKey: key });

describe('Grow webhook signature', () => {
  it('accepts the body it signed and nothing else', () => {
    const body = JSON.stringify({ id: 'e1' });
    const sig = signGrowWebhook(body, 'secret');
    expect(verifyGrowSignature(body, sig, 'secret')).toBe(true);
    expect(verifyGrowSignature(`${body} `, sig, 'secret')).toBe(false);
    expect(verifyGrowSignature(body, sig, 'other')).toBe(false);
    expect(verifyGrowSignature(body, null, 'secret')).toBe(false);
    expect(verifyGrowSignature(body, 'not-hex', 'secret')).toBe(false);
  });

  it('parses the normalized event', () => {
    expect(
      GrowWebhook.parse({
        id: 'e1',
        type: 'charge.failed',
        paymentId: 'p1',
        amountAgorot: 33_000,
        failureReason: 'card_declined',
        occurredAt: '2026-10-02T08:00:00+03:00',
      }).type,
    ).toBe('charge.failed');
  });
});

describe('fake providers', () => {
  it('charges idempotently and declines "fail" mandates or on demand', async () => {
    const grow = new FakePaymentProvider();
    const req = { mandateId: 'm1', amount: agorot(100), description: 'x' };
    const a = await grow.chargeStandingOrder(ctx('k1'), req);
    expect(a.status).toBe('succeeded');
    expect(await grow.chargeStandingOrder(ctx('k1'), req)).toEqual(a);
    expect(
      (await grow.chargeStandingOrder(ctx('k2'), { ...req, mandateId: 'fail-1' })).status,
    ).toBe('failed');
    grow.failNext = 1;
    expect((await grow.chargeStandingOrder(ctx('k3'), req)).failureReason).toBe('card_declined');
    expect((await grow.chargeStandingOrder(ctx('k4'), req)).status).toBe('succeeded');
    grow.pending = true;
    expect((await grow.chargeStandingOrder(ctx('k5'), req)).status).toBe('pending');
    const link = await grow.createPaymentLink(ctx('l1'), {
      householdId: 'h',
      amount: agorot(100),
      description: 'x',
    });
    expect(link.url).toContain(link.externalId);
    expect(
      (
        await grow.createStandingOrder(ctx('s1'), {
          householdId: 'h',
          amount: agorot(1),
          dayOfMonth: 1,
        })
      ).mandateId,
    ).toMatch(/^fake_mandate_/);
    await grow.cancelStandingOrder(ctx('c1'), 'm1');
    expect(
      (await grow.refund(ctx('r1'), { externalPaymentId: 'p', amount: agorot(1) }))
        .externalRefundId,
    ).toMatch(/^fake_refund_/);
    expect(grow.calls.map((c) => c.op)).toEqual([
      'charge',
      'charge',
      'charge',
      'charge',
      'charge',
      'charge',
      'link',
      'mandate',
      'cancelMandate',
      'refund',
    ]);
  });

  it('numbers invoices in order and returns the same document for a retried key', async () => {
    const inv = new FakeInvoicingProvider();
    const req = {
      client: { name: 'x' },
      lines: [{ description: 'd', amount: agorot(100), quantity: 1 }],
      paymentMethod: 'ביט',
    };
    const a = await inv.issueInvoiceReceipt(ctx('a'), req);
    const b = await inv.issueInvoiceReceipt(ctx('b'), req);
    expect([a.number, b.number]).toEqual(['10001', '10002']);
    expect(await inv.issueInvoiceReceipt(ctx('a'), req)).toEqual(a);
    expect(inv.issued).toHaveLength(2);
    expect(
      (await inv.issueCreditNote(ctx('c'), { originalDocumentId: a.documentId, lines: [] })).number,
    ).toBe('10003');
  });

  it('fake Green Invoice prints institution tax invoices and their receipts once per key', async () => {
    const inv = new FakeInvoicingProvider();
    const client = { name: 'בית ספר (דמו)' };
    const lines = [{ description: 'שיעורי שחייה', amount: agorot(72_000), quantity: 1 }];
    const tax = await inv.issueTaxInvoice(ctx('t'), { client, lines, dueOn: '2026-11-01' });
    expect(await inv.issueTaxInvoice(ctx('t'), { client, lines, dueOn: '2026-11-01' })).toEqual(
      tax,
    );
    const receipt = await inv.issueReceipt(ctx('r'), {
      client,
      invoiceDocumentId: tax.documentId,
      amount: agorot(36_000),
      paymentMethod: 'bank_transfer',
    });
    expect(receipt.number).toBe('10002');
    expect(inv.issued.map((d) => [d.kind, d.notes])).toEqual([
      ['tax_invoice', 'due 2026-11-01'],
      ['receipt', undefined],
    ]);
  });
});
