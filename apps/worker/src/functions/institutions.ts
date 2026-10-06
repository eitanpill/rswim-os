/**
 * Institutions (brief §6.11): an approved monthly invoice is printed as a tax invoice, and every payment recorded
 * against it gets its receipt, through the invoicing provider (a fake until the real account exists).
 */
import { z } from 'zod';
import { printInstitutionInvoice, printInstitutionReceipt } from '@rswim/domain-institutions';
import { inngest } from '../client';
import { invoicingProvider } from '../providers';
import { toEnvelope } from './core-ping';
import { sys, withProvider } from './billing';

export const institutionsPrintInvoice = inngest.createFunction(
  {
    id: 'institutions-print-invoice',
    triggers: [{ event: 'institutions.invoice_approved' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { invoiceId } = z.object({ invoiceId: z.uuid() }).parse(envelope.payload);
    return step.run('print', () =>
      withProvider('institutions-print-invoice', envelope, invoicingProvider(), (p, tx) =>
        printInstitutionInvoice(tx, sys(envelope), p, invoiceId),
      ),
    );
  },
);

export const institutionsPrintReceipt = inngest.createFunction(
  {
    id: 'institutions-print-receipt',
    triggers: [{ event: 'institutions.payment_recorded' }],
    retries: 5,
  },
  async ({ event, step }) => {
    const envelope = toEnvelope(event);
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(envelope.payload);
    return step.run('print', () =>
      withProvider('institutions-print-receipt', envelope, invoicingProvider(), (p, tx) =>
        printInstitutionReceipt(tx, sys(envelope), p, paymentId),
      ),
    );
  },
);
