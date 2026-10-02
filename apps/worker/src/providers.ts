import {
  FakeInvoicingProvider,
  FakePaymentProvider,
  type InvoicingProvider,
  type PaymentProvider,
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
export function invoicingProvider(): InvoicingProvider | null {
  if (process.env.RSWIM_INVOICING_FAKE === '1') return (invoicing ??= new FakeInvoicingProvider());
  return null;
}
