'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { CheckoutMethod } from '@rswim/contracts';
import { answerSandboxCheckout, startCheckoutForToken } from '@rswim/domain-billing';
import { toDomainError } from '@rswim/domain-core';
import { db } from '@/lib/db';
import type { FormState } from '@/lib/form-state';
import {
  checkoutUrls,
  gatewayFactory,
  onDivePaid,
  paymentsSandbox,
  requestOrigin,
} from '@/lib/payments';

const Token = z.string().regex(/^[A-Za-z0-9_-]{24,64}$/);

async function fail(code: string): Promise<FormState> {
  const t = await getTranslations();
  return { ok: false, errors: {}, message: t(t.has(code) ? code : 'forms.errors.invalid') };
}

/**
 * The customer chose how to pay. Nobody is signed in: the token in the link finds the checkout, and the business's
 * own processor opens its hosted page for that method, where the customer goes next.
 */
export async function startPayAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = Token.safeParse(fd.get('token'));
  const method = CheckoutMethod.safeParse(fd.get('method'));
  if (!token.success || !method.success) return fail('payments.errors.notOpen');
  const origin = await requestOrigin();
  let to: string;
  try {
    to = await startCheckoutForToken(db(), token.data, method.data, {
      build: gatewayFactory,
      urls: (connectionId) => checkoutUrls(origin, token.data, connectionId),
    });
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    return fail(de.code);
  }
  redirect(to);
}

/** The demo processor's hosted page answers (sandboxed processes only), through the real callback intake. */
export async function sandboxAnswerAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!paymentsSandbox()) return fail('payments.errors.notConnected');
  const token = Token.safeParse(fd.get('token'));
  const method = CheckoutMethod.safeParse(fd.get('method'));
  if (!token.success || !method.success) return fail('payments.errors.notOpen');
  const outcome = await answerSandboxCheckout(
    db(),
    token.data,
    method.data,
    fd.get('answer') === 'approve',
    { build: gatewayFactory, onDivePaid },
  );
  if (outcome === 'not_open') return fail('payments.errors.notOpen');
  if (outcome === 'not_configured') return fail('payments.errors.notConnected');
  redirect(`/pay/${token.data}?back=1`);
}
