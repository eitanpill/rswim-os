'use server';

import { z } from 'zod';
import { CheckoutMethod, PaymentGatewayKind } from '@rswim/contracts';
import {
  connectPaymentGateway,
  disconnectPaymentGateway,
  setPaymentMethods,
} from '@rswim/domain-billing';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { gatewayFactory, paymentsSandbox } from '@/lib/payments';

/** The swim school's screen and the dive club's show the same connection. */
const PAGES = ['/admin/integrations/payments', '/dive/payments'];

const Connect = z.object({
  provider: PaymentGatewayKind,
  methods: z.array(CheckoutMethod).default([]),
  credentials: z.record(z.string(), z.string()),
});

/** Fields arrive as `cred.<key>`; they are passed on as the credentials and never echoed back to the form. */
function credentialsOf(raw: Record<string, unknown>) {
  const credentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw))
    if (k.startsWith('cred.') && typeof v === 'string') credentials[k.slice(5)] = v;
  return { provider: raw.provider, methods: raw.methods ?? [], credentials };
}

export async function connectPaymentsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    Connect,
    (tx, ctx, input) =>
      connectPaymentGateway(tx, ctx, input, { build: gatewayFactory, sandbox: paymentsSandbox() }),
    {
      revalidate: PAGES,
      success: (r, tr) =>
        tr(r.status === 'connected' ? 'payments.connected' : 'payments.savedNotWorking'),
      errorField: (path) =>
        path[0] === 'credentials' ? `cred.${String(path[1])}` : String(path[0]),
    },
    credentialsOf,
  );
}

export async function paymentMethodsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ methods: z.array(CheckoutMethod).default([]) }),
    (tx, _ctx, { methods }) => setPaymentMethods(tx, methods),
    { revalidate: PAGES, success: 'payments.methodsSaved' },
  );
}

export async function disconnectPaymentsAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => disconnectPaymentGateway(tx), {
    revalidate: PAGES,
    success: 'payments.disconnected',
  });
}
