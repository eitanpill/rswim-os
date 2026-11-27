import { describe, expect, it } from 'vitest';
import {
  FakeInvoicingProvider,
  InvoicingNotLiveError,
  PAYMENT_GATEWAYS,
  processorDocumentsLive,
  processorInvoicing,
  processorIssuesDocuments,
} from '../src';

describe("the processor's own documents", () => {
  it('is offered only for processors whose API issues documents', () => {
    expect(processorIssuesDocuments('cardcom')).toBe(true);
    expect(processorIssuesDocuments('payplus')).toBe(true);
    expect(processorIssuesDocuments('grow')).toBe(false);
    expect(processorIssuesDocuments('tranzila')).toBe(false);
    expect(
      Object.values(PAYMENT_GATEWAYS).every((g) => ['api', 'none'].includes(g.documents)),
    ).toBe(true);
  });

  it('runs on a fake in a sandbox and is not live anywhere else yet', () => {
    expect(processorInvoicing('cardcom', {}, { sandbox: true })).toBeInstanceOf(
      FakeInvoicingProvider,
    );
    expect(() => processorInvoicing('cardcom', {}, { sandbox: false })).toThrow(
      InvoicingNotLiveError,
    );
    expect(() => processorInvoicing('grow', {}, { sandbox: true })).toThrow(InvoicingNotLiveError);
    expect(processorDocumentsLive('cardcom', { RSWIM_CARDCOM_LIVE: '1' })).toBe(false);
  });
});
