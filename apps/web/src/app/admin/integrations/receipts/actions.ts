'use server';

import { z } from 'zod';
import { InvoicingProviderKind } from '@rswim/contracts';
import { connectInvoicing, disconnectInvoicing } from '@rswim/domain-billing';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { invoicingFactory, processorDocsLive } from '@/lib/receipts';

/** The swim school's screen and the dive club's show the same connection. */
const PAGES = [
  '/admin/integrations/receipts',
  '/dive/receipts',
  '/admin/connections',
  '/dive/connections',
];

const Connect = z.object({
  provider: InvoicingProviderKind,
  credentials: z.record(z.string(), z.string()),
});

/** Fields arrive as `cred.<key>`; they are passed on as the credentials and never echoed back to the form. */
function credentialsOf(raw: Record<string, unknown>) {
  const credentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw))
    if (k.startsWith('cred.') && typeof v === 'string') credentials[k.slice(5)] = v;
  return { provider: raw.provider, credentials };
}

export async function connectReceiptsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    Connect,
    (tx, ctx, input) =>
      connectInvoicing(tx, ctx, input, {
        build: invoicingFactory,
        processorLive: processorDocsLive,
      }),
    {
      revalidate: PAGES,
      success: (r, tr) =>
        tr(
          r.status === 'connected'
            ? r.provider === 'processor'
              ? 'receipts.processorChosen'
              : 'receipts.connected'
            : 'receipts.savedNotWorking',
        ),
      errorField: (path) =>
        path[0] === 'credentials' ? `cred.${String(path[1])}` : String(path[0]),
    },
    credentialsOf,
  );
}

export async function disconnectReceiptsAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => disconnectInvoicing(tx), {
    revalidate: PAGES,
    success: 'receipts.disconnected',
  });
}
