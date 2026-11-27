import 'server-only';
import type { InvoicingFactory } from '@rswim/domain-billing';
import type { PaymentGatewayKind } from '@rswim/contracts';
import {
  createInvoicing,
  FakeInvoicingProvider,
  processorDocumentsLive,
} from '@rswim/integrations';
import { isDemoMode } from './auth/dev';

/** Local, E2E and the live demo: documents go to the worker's fake Morning, so any well-formed key connects. */
export function receiptsSandbox(): boolean {
  return process.env.RSWIM_INVOICING_FAKE === '1' || isDemoMode();
}

/** The business's Morning, or in a sandboxed process a fake whose check always passes (docs/payments/MORNING.md). */
export const invoicingFactory: InvoicingFactory = (kind, creds) =>
  receiptsSandbox()
    ? Object.assign(new FakeInvoicingProvider(), {
        testConnection: async () => ({ ok: true as const }),
      })
    : createInvoicing(kind, creds);

/** Whether the processor's own documents may be chosen as working in this process (always in a sandbox). */
export const processorDocsLive = (kind: PaymentGatewayKind): boolean =>
  receiptsSandbox() || processorDocumentsLive(kind);
